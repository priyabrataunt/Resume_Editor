import { useState, useEffect, useCallback, useRef } from 'react';
import Editor from './components/Editor.jsx';
import SuggestionPopup from './components/SuggestionPopup.jsx';
import PDFPreview from './components/PDFPreview.jsx';
import StatusBar from './components/StatusBar.jsx';
import { useSuggestions } from './hooks/useSuggestions.js';
import { useUndoStack } from './hooks/useUndoStack.js';

const DEFAULT_TEX = `\\documentclass[11pt]{article}
\\usepackage{geometry}
\\geometry{margin=1in}
\\usepackage{hyperref}

\\begin{document}

\\begin{center}
  {\\LARGE \\textbf{Your Name}} \\\\[4pt]
  your@email.com \\quad | \\quad linkedin.com/in/yourprofile \\\\
  San Francisco, CA
\\end{center}

\\section*{Experience}

\\textbf{Software Engineer} — Acme Corp \\hfill 2022–Present \\\\
\\begin{itemize}
  \\item Built REST APIs using Node.js and Express
  \\item Worked on the frontend with React
  \\item Participated in code reviews and agile sprints
  \\item Helped reduce page load time by optimizing queries
\\end{itemize}

\\textbf{Junior Developer} — Startup Inc \\hfill 2020–2022 \\\\
\\begin{itemize}
  \\item Developed features across the full stack
  \\item Wrote unit tests using Jest
  \\item Collaborated with design team on UI improvements
\\end{itemize}

\\section*{Education}

\\textbf{B.S. Computer Science} — State University \\hfill 2020

\\section*{Skills}

JavaScript, TypeScript, React, Node.js, PostgreSQL, Git, Docker

\\end{document}`;

export default function App() {
  const [resumeText, setResumeText] = useState(DEFAULT_TEX);
  const [fileName, setFileName] = useState('resume.tex');
  const [jdText, setJdText] = useState('');
  const [showPDF, setShowPDF] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [compileStatus, setCompileStatus] = useState('idle'); // idle | compiling | done | error
  const [compileError, setCompileError] = useState(null);
  const [lastCompileTime, setLastCompileTime] = useState(null);
  const [personaActive, setPersonaActive] = useState(false);
  const [popupState, setPopupState] = useState(null); // { position: {x,y}, currentIndex: number } | null
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: false, openaiConfigured: false });
  const fileInputRef = useRef(null);
  const pdfBlobRef = useRef(null);

  const { suggestions, atsScore, scoreBreakdown, status: suggestStatus, error: suggestError, fetch: fetchSuggestions, dismiss, dismissAll, pendingCount } = useSuggestions();
  const { push: pushUndo, pop: popUndo, canUndo } = useUndoStack();

  const [baselineAts, setBaselineAts] = useState(null);

  // On load: read ?jd= and ?ats= URL params, and fetch uploaded resume from job tracker
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jd = params.get('jd');
    if (jd) setJdText(jd);
    const ats = params.get('ats');
    if (ats) setBaselineAts(parseInt(ats, 10));

    // Try to load the resume uploaded in the Job Tracker
    fetch('http://localhost:8000/api/resume')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.uploaded && data.resumeText?.trim()) {
          setResumeText(data.resumeText.trim());
          if (data.filename) setFileName(data.filename);
        }
      })
      .catch(() => { /* job tracker not running, keep default template */ });
  }, []);

  // On load: ping backend health and check persona
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.ok ? r.json() : { ok: false })
      .then(d => setBackendHealth({ checked: true, ok: !!d.ok, openaiConfigured: !!d.deepseek_configured }))
      .catch(() => setBackendHealth({ checked: true, ok: false, openaiConfigured: false }));

    fetch('/api/persona')
      .then(r => r.ok ? r.json() : { active: false })
      .then(d => setPersonaActive(d.active ?? false))
      .catch(() => {});
  }, []);

  // ── File Open ───────────────────────────────────────────────────────────────
  function handleOpenFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => setResumeText(ev.target.result ?? '');
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── Compile ─────────────────────────────────────────────────────────────────
  async function handleCompile() {
    setCompileStatus('compiling');
    setCompileError(null);
    try {
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tex: resumeText }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Compile error ${res.status}`);
      }
      const blob = await res.blob();
      if (pdfBlobRef.current) URL.revokeObjectURL(pdfBlobRef.current);
      const url = URL.createObjectURL(blob);
      pdfBlobRef.current = url;
      setPdfUrl(url);
      setShowPDF(true);
      setCompileStatus('done');
      setLastCompileTime(new Date());
    } catch (err) {
      setCompileError(err.message);
      setCompileStatus('error');
    }
  }

  // ── Suggest ─────────────────────────────────────────────────────────────────
  async function handleSuggest() {
    if (!jdText.trim()) {
      alert('Please paste a job description first.');
      return;
    }
    dismissAll();
    setPopupState(null);
    setAcceptedCount(0);
    setRejectedCount(0);
    await fetchSuggestions(resumeText, jdText);
  }

  // ── Badge click → open popup ─────────────────────────────────────────────────
  const handleBadgeClick = useCallback((_lineNumber, firstGlobalIdx, event) => {
    setPopupState({
      position: { x: event.clientX + 12, y: event.clientY - 20 },
      currentIndex: firstGlobalIdx,
    });
  }, []);

  // ── Popup navigation ─────────────────────────────────────────────────────────
  function handleNavigate(direction) {
    if (!popupState) return;
    const next = popupState.currentIndex + direction;
    if (next < 0 || next >= suggestions.length) return;
    setPopupState({ ...popupState, currentIndex: next });
  }

  // ── Keep New: apply suggestion to editor ─────────────────────────────────────
  function handleKeepNew(suggestionIdx) {
    const s = suggestions[suggestionIdx];
    if (!s) return;

    // Guard: reject suggestions with unbalanced braces (would break LaTeX)
    // Skip brace check for 'remove' type (new is empty)
    if (s.new) {
      const braceBalance = (str) => {
        let depth = 0;
        for (const ch of str) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
          if (depth < 0) return false;
        }
        return depth === 0;
      };
      if (!braceBalance(s.new)) {
        alert('This suggestion has unbalanced braces and cannot be applied safely. It has been dismissed.');
        dismiss(suggestionIdx);
        if (suggestions.length <= 1) setPopupState(null);
        else setPopupState(prev => prev ? { ...prev, currentIndex: Math.min(suggestionIdx, suggestions.length - 2) } : null);
        return;
      }
    }

    // Handle 'remove' type — delete the line entirely
    if (s.type === 'remove' && !s.new) {
      const lines = resumeText.split('\n');
      const lineIdx = s.line - 1;
      if (lineIdx >= 0 && lineIdx < lines.length) {
        pushUndo({ old: s.old, new: '', line: s.line });
        lines.splice(lineIdx, 1);
        setResumeText(lines.join('\n'));
      }
    } else {
      // Replace old text with new text in resumeText
      const updated = resumeText.replace(s.old, () => s.new);
      if (updated === resumeText) {
        // Couldn't find exact match — still apply by line number
        const lines = resumeText.split('\n');
        const lineIdx = s.line - 1;
        if (lineIdx >= 0 && lineIdx < lines.length) {
          lines[lineIdx] = s.new;
          pushUndo({ old: s.old, new: s.new, line: s.line });
          setResumeText(lines.join('\n'));
        }
      } else {
        pushUndo({ old: s.old, new: s.new, line: s.line });
        setResumeText(updated);
      }
    }

    setAcceptedCount(c => c + 1);
    dismiss(suggestionIdx);

    // Advance popup or close
    if (suggestions.length <= 1) {
      setPopupState(null);
    } else {
      const nextIdx = Math.min(suggestionIdx, suggestions.length - 2);
      setPopupState(prev => prev ? { ...prev, currentIndex: nextIdx } : null);
    }
  }

  // ── Keep Old: dismiss suggestion ─────────────────────────────────────────────
  function handleKeepOld(suggestionIdx) {
    setRejectedCount(c => c + 1);
    dismiss(suggestionIdx);
    if (suggestions.length <= 1) {
      setPopupState(null);
    } else {
      const nextIdx = Math.min(suggestionIdx, suggestions.length - 2);
      setPopupState(prev => prev ? { ...prev, currentIndex: nextIdx } : null);
    }
  }

  // ── Undo ─────────────────────────────────────────────────────────────────────
  function handleUndo() {
    const entry = popUndo();
    if (!entry) return;
    if (!entry.new) {
      // Undo a 'remove' — re-insert the deleted line
      setResumeText(prev => {
        const lines = prev.split('\n');
        const insertIdx = Math.min(entry.line - 1, lines.length);
        lines.splice(insertIdx, 0, entry.old);
        return lines.join('\n');
      });
    } else {
      setResumeText(prev => prev.replace(entry.new, () => entry.old));
    }
    setAcceptedCount(c => Math.max(0, c - 1));
  }

  // ── Refresh persona ───────────────────────────────────────────────────────────
  async function handleRefreshPersona() {
    const folder = prompt('Enter path to writing samples folder:');
    if (!folder) return;
    try {
      const res = await fetch('/api/distill-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ samplesFolder: folder }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed');
      }
      setPersonaActive(true);
      alert('Persona distilled successfully!');
    } catch (err) {
      alert(`Persona distillation failed: ${err.message}`);
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  const S = {
    root: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#0d0d1a',
      color: '#cdd6f4',
    },
    toolbar: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      borderBottom: '1px solid #1a1a2e',
      background: '#11111f',
      flexShrink: 0,
    },
    fileName: {
      fontSize: 13,
      color: '#888',
      marginRight: 4,
    },
    pill: {
      padding: '3px 10px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      background: 'rgba(251, 191, 36, 0.15)',
      color: '#fbbf24',
      border: '1px solid rgba(251, 191, 36, 0.3)',
    },
    btn: {
      padding: '4px 12px',
      borderRadius: 6,
      border: '1px solid #2d2d4a',
      background: '#1a1a2e',
      color: '#ccc',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 500,
    },
    btnPrimary: {
      padding: '4px 12px',
      borderRadius: 6,
      border: 'none',
      background: '#4f46e5',
      color: '#fff',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600,
    },
    jdBar: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '6px 12px',
      borderBottom: '1px solid #1a1a2e',
      background: '#0f0f1c',
      flexShrink: 0,
    },
    jdInput: {
      flex: 1,
      background: '#1a1a2e',
      border: '1px solid #2d2d4a',
      borderRadius: 6,
      color: '#cdd6f4',
      fontSize: 12,
      padding: '5px 10px',
      outline: 'none',
      resize: 'vertical',
      minHeight: 72,
      fontFamily: 'inherit',
      lineHeight: 1.5,
    },
    editorArea: {
      flex: 1,
      display: 'flex',
      overflow: 'hidden',
    },
    editorPane: {
      flex: showPDF ? '0 0 55%' : '1',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    },
    separator: {
      width: 1,
      background: '#1a1a2e',
      flexShrink: 0,
    },
  };

  // Health banner: show only if there's an actionable problem
  const showHealthBanner = backendHealth.checked && (!backendHealth.ok || !backendHealth.openaiConfigured);
  const healthMessage = !backendHealth.ok
    ? '⚠ Backend not reachable on :3002 — start it with `cd backend && npm run dev`'
    : '⚠ DEEPSEEK_API_KEY not configured — add it to backend/.env to enable AI suggestions';
  const healthColor = !backendHealth.ok ? '#f87171' : '#fbbf24';
  const healthBg = !backendHealth.ok ? 'rgba(248, 113, 113, 0.1)' : 'rgba(251, 191, 36, 0.1)';

  return (
    <div style={S.root}>
      {/* Health Banner */}
      {showHealthBanner && (
        <div style={{
          padding: '6px 14px',
          background: healthBg,
          color: healthColor,
          borderBottom: `1px solid ${healthColor}33`,
          fontSize: 12,
          fontWeight: 500,
          flexShrink: 0,
        }}>
          {healthMessage}
        </div>
      )}

      {/* Toolbar */}
      <div style={S.toolbar}>
        <span style={S.fileName}>{fileName}</span>

        <button style={S.btn} onClick={() => fileInputRef.current?.click()}>Open .tex</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tex"
          style={{ display: 'none' }}
          onChange={handleOpenFile}
        />

        {pendingCount > 0 && (
          <span style={S.pill}>{pendingCount} suggestion{pendingCount > 1 ? 's' : ''} pending</span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            style={{ ...S.btn, opacity: canUndo ? 1 : 0.4 }}
            disabled={!canUndo}
            onClick={handleUndo}
            title="Undo last accepted suggestion"
          >
            ↩ Undo
          </button>

          <button
            style={{ ...S.btn, color: showPDF ? '#a78bfa' : '#ccc' }}
            onClick={() => setShowPDF(v => !v)}
          >
            {showPDF ? 'Hide PDF' : 'PDF Preview'}
          </button>

          <button
            style={{ ...S.btn, opacity: compileStatus === 'compiling' ? 0.6 : 1 }}
            disabled={compileStatus === 'compiling'}
            onClick={handleCompile}
          >
            {compileStatus === 'compiling' ? 'Compiling…' : '⬡ Compile'}
          </button>
        </div>
      </div>

      {/* JD Bar */}
      <div style={S.jdBar}>
        <span style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap', paddingTop: 6 }}>Job Description</span>
        <textarea
          style={S.jdInput}
          rows={4}
          placeholder="Paste the full job description here…"
          value={jdText}
          onChange={e => setJdText(e.target.value)}
        />
        <button
          style={{
            ...S.btnPrimary,
            opacity: suggestStatus === 'loading' ? 0.6 : 1,
          }}
          disabled={suggestStatus === 'loading'}
          onClick={handleSuggest}
        >
          {suggestStatus === 'loading' ? '⟳ Analyzing…' : '✨ Suggest'}
        </button>
      </div>

      {/* Inline error row for suggest failures */}
      {suggestError && (
        <div style={{
          padding: '6px 14px',
          background: 'rgba(248, 113, 113, 0.08)',
          color: '#f87171',
          borderBottom: '1px solid rgba(248, 113, 113, 0.2)',
          fontSize: 12,
          flexShrink: 0,
        }}>
          ⚠ {suggestError}
        </div>
      )}

      {/* Editor + PDF area */}
      <div style={S.editorArea}>
        <div style={S.editorPane}>
          <Editor
            value={resumeText}
            onChange={v => setResumeText(v ?? '')}
            suggestions={suggestions}
            onBadgeClick={handleBadgeClick}
          />
        </div>

        {showPDF && (
          <PDFPreview
            pdfUrl={pdfUrl}
            isCompiling={compileStatus === 'compiling'}
            error={compileError}
            fileName={fileName}
          />
        )}
      </div>

      {/* Status Bar */}
      <StatusBar
        fileName={fileName}
        lastCompileTime={lastCompileTime}
        pendingCount={pendingCount}
        acceptedCount={acceptedCount}
        rejectedCount={rejectedCount}
        baselineAts={baselineAts}
        atsScore={atsScore}
        scoreBreakdown={scoreBreakdown}
        personaActive={personaActive}
        onRefreshPersona={handleRefreshPersona}
      />

      {/* Suggestion Popup */}
      {popupState && suggestions.length > 0 && (
        <SuggestionPopup
          suggestions={suggestions}
          currentIndex={Math.min(popupState.currentIndex, suggestions.length - 1)}
          position={popupState.position}
          onNavigate={handleNavigate}
          onKeepNew={handleKeepNew}
          onKeepOld={handleKeepOld}
          onClose={() => setPopupState(null)}
        />
      )}
    </div>
  );
}
