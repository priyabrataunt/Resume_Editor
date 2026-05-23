import { useState, useEffect, useCallback, useRef } from 'react';
import Editor from './components/Editor.jsx';
import SuggestionPopup from './components/SuggestionPopup.jsx';
import PDFPreview from './components/PDFPreview.jsx';
import StatusBar from './components/StatusBar.jsx';
import { useSuggestions } from './hooks/useSuggestions.js';
import { useUndoStack } from './hooks/useUndoStack.js';
import { sanitizeLatexText, isItemizeBalanced } from './utils/latexSafety.js';

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

function slugifyProfileName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'profile';
}

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
  const [personaInfo, setPersonaInfo] = useState({ source: 'none', chars: 0 });
  const [popupState, setPopupState] = useState(null); // { position: {x,y}, currentIndex: number } | null
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: false, openaiConfigured: false });
  const fileInputRef = useRef(null);
  const pdfBlobRef = useRef(null);

  const {
    suggestions,
    atsScore,
    projectedScore,
    scoreBreakdown,
    jdSummary,
    status: suggestStatus,
    error: suggestError,
    fetch: fetchSuggestions,
    dismiss,
    dismissAll,
    pendingCount,
  } = useSuggestions();
  const { push: pushUndo, pop: popUndo, canUndo } = useUndoStack();

  const [baselineAts, setBaselineAts] = useState(null);
  const [reSuggestOffer, setReSuggestOffer] = useState(false);

  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [activeProfileSlug, setActiveProfileSlug] = useState(null);
  const [activeProfileName, setActiveProfileName] = useState('');
  const [profileRoleType, setProfileRoleType] = useState('');
  const [profileDescription, setProfileDescription] = useState('');
  const [profileNotice, setProfileNotice] = useState(null);
  const [autoDetectLoading, setAutoDetectLoading] = useState(false);

  const refreshProfileList = useCallback(async () => {
    try {
      const r = await fetch('/api/profiles');
      if (!r.ok) return [];
      const d = await r.json();
      const list = d.profiles ?? [];
      setProfiles(list);
      return list;
    } catch {
      setProfiles([]);
      return [];
    }
  }, []);

  const loadProfileBySlug = useCallback(async (slug) => {
    if (!slug) return;
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(slug)}`);
      if (!r.ok) throw new Error('Failed to load profile');
      const d = await r.json();
      setActiveProfileSlug(d.slug);
      setActiveProfileName(d.name ?? slug);
      setProfileRoleType(d.roleType ?? '');
      setProfileDescription(d.description ?? '');
      setResumeText(typeof d.tex === 'string' ? d.tex : '');
      setFileName(`${(d.name ?? slug).replace(/\s+/g, '-')}.tex`);
    } catch {
      setProfileNotice('Could not load that profile.');
    }
  }, []);

  // Optional ?ats= from external links (job tracker). Job description is never loaded from URL —
  // users paste a fresh JD per application below (session-only, not saved).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ats = params.get('ats');
    if (ats) setBaselineAts(parseInt(ats, 10));
  }, []);

  // Load saved profiles first. Job-tracker resume import runs only when there are no profiles.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProfilesLoading(true);
      const list = await refreshProfileList();
      if (cancelled) return;
      setProfilesLoading(false);
      if (list.length > 0) {
        await loadProfileBySlug(list[0].slug);
      } else {
        fetch('http://localhost:8000/api/resume')
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (cancelled) return;
            if (data?.uploaded && data.resumeText?.trim()) {
              setResumeText(data.resumeText.trim());
              if (data.filename) setFileName(data.filename);
            }
          })
          .catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, [refreshProfileList, loadProfileBySlug]);

  // On load: ping backend health and check persona
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.ok ? r.json() : { ok: false })
      .then(d => setBackendHealth({ checked: true, ok: !!d.ok, openaiConfigured: !!d.openai_configured }))
      .catch(() => setBackendHealth({ checked: true, ok: false, openaiConfigured: false }));

    fetch('/api/persona')
      .then(r => r.ok ? r.json() : { active: false })
      .then(d => {
        setPersonaActive(d.active ?? false);
        setPersonaInfo({ source: d.source ?? 'none', chars: d.chars ?? 0 });
      })
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

  function handleProfileSelectChange(e) {
    const slug = e.target.value;
    if (!slug) return;
    setProfileNotice(null);
    loadProfileBySlug(slug);
  }

  async function handleSaveProfile() {
    setProfileNotice(null);
    const name = (activeProfileName || '').trim();
    if (!name) {
      setProfileNotice('Enter a profile name before saving.');
      return;
    }
    let slug = activeProfileSlug;
    if (!slug) {
      const list = await refreshProfileList();
      let base = slugifyProfileName(name);
      slug = base;
      let n = 2;
      while (list.some(p => p.slug === slug)) {
        slug = `${base}-${n++}`;
      }
    }
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          roleType: profileRoleType,
          description: profileDescription,
          tex: resumeText,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = d.latexError ? `\n\n${d.latexError}` : '';
        throw new Error(`${d.error ?? 'Save failed'}${detail}`);
      }
      await refreshProfileList();
      await loadProfileBySlug(d.slug ?? slug);
      setProfileNotice('Profile saved.');
    } catch (err) {
      setProfileNotice(err.message ?? String(err));
    }
  }

  async function handleNewProfile() {
    setProfileNotice(null);
    const name = window.prompt('New profile name (e.g. AI Engineering):');
    if (!name?.trim()) return;
    const roleType = window.prompt('Role type (helps auto-detect):', '') ?? '';
    const description = window.prompt('Short description for auto-detect (optional):', '') ?? '';
    const list = await refreshProfileList();
    let base = slugifyProfileName(name);
    let slug = base;
    let n = 2;
    while (list.some(p => p.slug === slug)) {
      slug = `${base}-${n++}`;
    }
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          roleType,
          description,
          tex: resumeText,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = d.latexError ? `\n\n${d.latexError}` : '';
        throw new Error(`${d.error ?? 'Create failed'}${detail}`);
      }
      await refreshProfileList();
      await loadProfileBySlug(d.slug ?? slug);
      setProfileNotice('New profile created from the current editor.');
    } catch (err) {
      setProfileNotice(err.message ?? String(err));
    }
  }

  async function handleAutoDetectProfile() {
    if (!jdText.trim()) {
      setProfileNotice('Paste a job description first, then run auto-detect.');
      return;
    }
    setProfileNotice(null);
    setAutoDetectLoading(true);
    try {
      const r = await fetch('/api/profiles/auto-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription: jdText }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Auto-detect failed');
      if (d.slug) {
        await loadProfileBySlug(d.slug);
        setProfileNotice(
          `Using “${d.slug}” (${d.confidence ?? 0}% confidence). ${d.reasoning || ''}`.trim()
        );
      } else {
        setProfileNotice(d.reasoning || 'No profile matched this job description.');
      }
    } catch (err) {
      setProfileNotice(err.message ?? String(err));
    } finally {
      setAutoDetectLoading(false);
    }
  }

  async function handleDeleteProfile() {
    if (!activeProfileSlug) return;
    if (!window.confirm(`Delete profile “${activeProfileName || activeProfileSlug}” permanently?`)) return;
    setProfileNotice(null);
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(activeProfileSlug)}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Delete failed');
      }
      const list = await refreshProfileList();
      setProfileNotice('Profile deleted.');
      if (list.length > 0) {
        await loadProfileBySlug(list[0].slug);
      } else {
        setActiveProfileSlug(null);
        setActiveProfileName('');
        setProfileRoleType('');
        setProfileDescription('');
        setResumeText(DEFAULT_TEX);
        setFileName('resume.tex');
      }
    } catch (err) {
      setProfileNotice(err.message ?? String(err));
    }
  }

  // ── Compile ─────────────────────────────────────────────────────────────────
  async function handleCompile(sourceTex = resumeText) {
    const texToCompile = typeof sourceTex === 'string' ? sourceTex : resumeText;
    setCompileStatus('compiling');
    setCompileError(null);
    try {
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tex: texToCompile }),
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
    if (!activeProfileSlug) {
      alert(
        'Choose a saved resume profile in the dropdown above (or click + New to create one). Suggestions combine that resume with the job description below.'
      );
      return;
    }
    if (!jdText.trim()) {
      alert(
        'Paste this employer’s job description in the Job description box below. It is only used for this run and is not saved.'
      );
      return;
    }
    dismissAll();
    setPopupState(null);
    setReSuggestOffer(false);
    setAcceptedCount(0);
    setRejectedCount(0);
    await fetchSuggestions(resumeText, jdText);
  }

  async function handleSuggestAgain() {
    if (!jdText.trim()) return;
    setReSuggestOffer(false);
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

  // ── Pure: apply a single suggestion to a text snapshot ──────────────────────
  // Returns { nextText, undoEntry } on success, or { error } on failure.
  // Does NOT touch any React state — callable both by single-apply and by
  // "Apply all" which folds it over the entire pending list.
  function applySuggestionToText(currentText, s) {
    const sanitisedNew = s.type === 'remove' ? '' : sanitizeLatexText(s.new ?? '');
    const lines = currentText.split('\n');
    const lineIdx = s.line - 1;
    const lineInRange = lineIdx >= 0 && lineIdx < lines.length;
    const lineText = lineInRange ? lines[lineIdx] : '';

    if (s.type === 'remove' && !sanitisedNew) {
      if (!lineInRange) return { error: 'Target line is out of range.' };
      const undoEntry = { old: s.old, new: '', line: s.line };
      lines.splice(lineIdx, 1);
      const nextText = lines.join('\n');
      if (!isItemizeBalanced(nextText)) {
        return { error: 'Would break LaTeX list structure (unbalanced itemize).' };
      }
      return { nextText, undoEntry };
    }

    let nextText = null;
    let undoEntry = null;

    if (s.old && lineInRange) {
      if (lineText === s.old) {
        lines[lineIdx] = sanitisedNew;
        undoEntry = { line: s.line, lineUndoBefore: lineText, old: s.old, new: sanitisedNew };
        nextText = lines.join('\n');
      } else if (lineText.includes(s.old)) {
        const nextLine = lineText.replace(s.old, () => sanitisedNew);
        if (nextLine !== lineText) {
          lines[lineIdx] = nextLine;
          undoEntry = { line: s.line, lineUndoBefore: lineText, old: s.old, new: sanitisedNew };
          nextText = lines.join('\n');
        }
      } else {
        const updated = currentText.replace(s.old, () => sanitisedNew);
        if (updated !== currentText) {
          undoEntry = { old: s.old, new: sanitisedNew, line: s.line };
          nextText = updated;
        } else if (lineInRange) {
          lines[lineIdx] = sanitisedNew;
          undoEntry = { line: s.line, lineUndoBefore: lineText, old: s.old, new: sanitisedNew };
          nextText = lines.join('\n');
        }
      }
    } else if (!s.old && lineInRange) {
      lines[lineIdx] = sanitisedNew;
      undoEntry = { line: s.line, lineUndoBefore: lineText, old: '', new: sanitisedNew };
      nextText = lines.join('\n');
    } else if (s.old) {
      const updated = currentText.replace(s.old, () => sanitisedNew);
      if (updated !== currentText) {
        undoEntry = { old: s.old, new: sanitisedNew, line: s.line };
        nextText = updated;
      } else if (lineInRange) {
        lines[lineIdx] = sanitisedNew;
        undoEntry = { line: s.line, lineUndoBefore: lineText, old: s.old, new: sanitisedNew };
        nextText = lines.join('\n');
      }
    }

    if (nextText === null) {
      return { error: 'Could not locate target text in the editor.' };
    }
    if (!isItemizeBalanced(nextText)) {
      return { error: 'Would break LaTeX list structure (unbalanced itemize).' };
    }
    return { nextText, undoEntry };
  }

  // ── Keep New: apply suggestion to editor ─────────────────────────────────────
  function handleKeepNew(suggestionIdx) {
    const s = suggestions[suggestionIdx];
    if (!s) return;

    const result = applySuggestionToText(resumeText, s);
    if (result.error) {
      setCompileError(`Suggestion rejected: ${result.error} Suggestion skipped.`);
      return;
    }
    if (result.undoEntry) pushUndo(result.undoEntry);
    setResumeText(result.nextText);

    setAcceptedCount(c => c + 1);
    dismiss(suggestionIdx);

    if (suggestions.length <= 1) {
      setPopupState(null);
    } else {
      const nextIdx = Math.min(suggestionIdx, suggestions.length - 2);
      setPopupState(prev => prev ? { ...prev, currentIndex: nextIdx } : null);
    }
  }

  // ── Apply all pending suggestions in one click ──────────────────────────────
  // Iterates in descending line order (so deletions don't shift later targets)
  // and skips any item that would break the LaTeX. Reports a summary.
  async function handleApplyAll() {
    if (suggestions.length === 0) return;

    const ordered = suggestions
      .map((s, idx) => ({ s, idx }))
      .sort((a, b) => (b.s.line || 0) - (a.s.line || 0));

    let workingText = resumeText;
    const applied = [];
    const skipped = [];

    for (const { s, idx } of ordered) {
      const result = applySuggestionToText(workingText, s);
      if (result.error) {
        skipped.push({ idx, reason: result.error });
        continue;
      }
      workingText = result.nextText;
      if (result.undoEntry) pushUndo(result.undoEntry);
      applied.push(idx);
    }

    if (workingText !== resumeText) {
      setResumeText(workingText);
    }
    setAcceptedCount(c => c + applied.length);
    setRejectedCount(c => c + skipped.length);

    dismissAll();
    setPopupState(null);
    setReSuggestOffer(applied.length > 0 && !!jdText.trim());

    if (skipped.length > 0) {
      const head = skipped.slice(0, 3).map(x => x.reason).join('; ');
      const tail = skipped.length > 3 ? ` (+${skipped.length - 3} more)` : '';
      setCompileError(
        `Applied ${applied.length} suggestion${applied.length === 1 ? '' : 's'}, skipped ${skipped.length}: ${head}${tail}`
      );
    } else {
      setCompileError(null);
    }

    if (applied.length > 0) {
      await handleCompile(workingText);
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
    } else if (entry.lineUndoBefore != null && entry.line != null) {
      setResumeText(prev => {
        const lines = prev.split('\n');
        const i = entry.line - 1;
        if (i >= 0 && i < lines.length) lines[i] = entry.lineUndoBefore;
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
  const labelMuted = '#8b92a8';
  const S = {
    root: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#0c0c18',
      color: '#dce1f0',
    },
    toolbar: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 14px',
      borderBottom: '1px solid rgba(99, 102, 241, 0.12)',
      background: 'linear-gradient(180deg, #12121f 0%, #10101c 100%)',
      boxShadow: '0 1px 0 rgba(255, 255, 255, 0.03)',
      flexShrink: 0,
    },
    fileName: {
      fontSize: 13,
      color: '#9ca8c9',
      marginRight: 4,
      fontWeight: 500,
      letterSpacing: '-0.01em',
    },
    pill: {
      padding: '4px 11px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      background: 'rgba(251, 191, 36, 0.12)',
      color: '#fcd34d',
      border: '1px solid rgba(251, 191, 36, 0.28)',
      letterSpacing: '0.02em',
    },
    btn: {
      padding: '5px 13px',
      borderRadius: 8,
      border: '1px solid rgba(99, 102, 241, 0.22)',
      background: 'rgba(26, 26, 46, 0.9)',
      color: '#d4d8e8',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 500,
      transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
    },
    btnPrimary: {
      padding: '5px 14px',
      borderRadius: 8,
      border: 'none',
      background: 'linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)',
      color: '#fff',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600,
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
      transition: 'filter 0.15s ease, opacity 0.15s ease',
    },
    profileBar: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
      padding: '8px 14px',
      borderBottom: '1px solid rgba(99, 102, 241, 0.1)',
      background: '#11111d',
      flexShrink: 0,
    },
    profileSelect: {
      minWidth: 140,
      maxWidth: 220,
      padding: '5px 10px',
      borderRadius: 8,
      border: '1px solid rgba(99, 102, 241, 0.25)',
      background: '#18182a',
      color: '#e8eaf5',
      fontSize: 12,
    },
    profileField: {
      padding: '5px 10px',
      borderRadius: 8,
      border: '1px solid rgba(99, 102, 241, 0.22)',
      background: '#18182a',
      color: '#e8eaf5',
      fontSize: 12,
      outline: 'none',
    },
    jdBar: {
      display: 'flex',
      alignItems: 'stretch',
      gap: 10,
      padding: '8px 14px',
      borderBottom: '1px solid rgba(99, 102, 241, 0.1)',
      background: '#0e0e18',
      flexShrink: 0,
    },
    jdInput: {
      flex: 1,
      background: '#18182a',
      border: '1px solid rgba(99, 102, 241, 0.22)',
      borderRadius: 8,
      color: '#e8eaf5',
      fontSize: 12,
      padding: '8px 12px',
      outline: 'none',
      resize: 'vertical',
      minHeight: 76,
      fontFamily: 'inherit',
      lineHeight: 1.55,
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
    : '⚠ OPENAI_API_KEY not configured — add it to backend/.env to enable AI suggestions';
  const healthColor = !backendHealth.ok ? '#f87171' : '#fbbf24';
  const healthBg = !backendHealth.ok ? 'rgba(248, 113, 113, 0.1)' : 'rgba(251, 191, 36, 0.1)';

  const profileNoticePositive =
    profileNotice &&
    /^(Profile saved\.|New profile created|Profile deleted\.|Using “)/.test(profileNotice);

  const suggestStageLabel = suggestStatus === 'loading' ? 'Suggesting…' : 'Suggest';
  const experienceGap =
    atsScore != null &&
    scoreBreakdown?.experience_alignment != null &&
    scoreBreakdown.experience_alignment < 50;

  return (
    <div style={S.root}>
      <style>{`
        .app-btn:not(:disabled):hover {
          background: rgba(36, 36, 58, 0.98);
          border-color: rgba(129, 140, 248, 0.4);
          color: #f0f2f8;
        }
        .app-btn:disabled {
          cursor: not-allowed;
        }
        .app-btn-primary:not(:disabled):hover {
          filter: brightness(1.07);
        }
        .app-btn-primary:disabled {
          cursor: not-allowed;
        }
      `}</style>
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

        <button type="button" className="app-btn" style={S.btn} onClick={() => fileInputRef.current?.click()}>Open .tex</button>
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

        {pendingCount > 0 && (
          <button
            type="button"
            className="app-btn app-btn-primary"
            style={{
              ...S.btnPrimary,
              background: 'linear-gradient(180deg, #16a34a 0%, #15803d 100%)',
            }}
            onClick={handleApplyAll}
            title={`Apply all ${pendingCount} pending suggestion${pendingCount > 1 ? 's' : ''} in one click. Each undo step is recorded so you can roll back.`}
          >
            Apply all {pendingCount}
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="app-btn"
            style={{ ...S.btn, opacity: canUndo ? 1 : 0.4 }}
            disabled={!canUndo}
            onClick={handleUndo}
            title="Undo last accepted suggestion"
          >
            Undo
          </button>

          <button
            type="button"
            className="app-btn"
            style={{
              ...S.btn,
              color: showPDF ? '#c4b5fd' : '#d4d8e8',
              borderColor: showPDF ? 'rgba(167, 139, 250, 0.45)' : S.btn.border,
              background: showPDF ? 'rgba(91, 33, 182, 0.2)' : S.btn.background,
            }}
            onClick={() => setShowPDF(v => !v)}
          >
            {showPDF ? 'Hide PDF' : 'PDF preview'}
          </button>

          <button
            type="button"
            className="app-btn"
            style={{ ...S.btn, opacity: compileStatus === 'compiling' ? 0.6 : 1 }}
            disabled={compileStatus === 'compiling'}
            onClick={handleCompile}
          >
            {compileStatus === 'compiling' ? 'Compiling…' : 'Compile'}
          </button>
        </div>
      </div>

      {/* Saved resume variants (LaTeX). Job postings are pasted below — not here. */}
      <div style={S.profileBar}>
        <span style={{ fontSize: 12, color: labelMuted, whiteSpace: 'nowrap', fontWeight: 600 }} title="Saved .tex per role">
          Resume profile
        </span>
        <select
          style={S.profileSelect}
          value={activeProfileSlug && profiles.some(p => p.slug === activeProfileSlug) ? activeProfileSlug : ''}
          onChange={handleProfileSelectChange}
          disabled={profilesLoading || profiles.length === 0}
        >
          {profiles.length === 0 ? (
            <option value="">No saved profiles yet</option>
          ) : (
            profiles.map(p => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))
          )}
        </select>
        <input
          type="text"
          style={{ ...S.profileField, width: 140 }}
          placeholder="Name"
          value={activeProfileName}
          onChange={e => setActiveProfileName(e.target.value)}
          disabled={profilesLoading}
        />
        <input
          type="text"
          style={{ ...S.profileField, width: 120 }}
          placeholder="Role type"
          value={profileRoleType}
          onChange={e => setProfileRoleType(e.target.value)}
          disabled={profilesLoading}
        />
        <input
          type="text"
          style={{ ...S.profileField, flex: '1 1 120px', minWidth: 100 }}
          placeholder="About this resume (optional)"
          title="Short notes about this resume variant (e.g. “MLE, PyTorch”). Helps Auto-detect match your profiles to the job description below. This is NOT the employer’s job posting."
          value={profileDescription}
          onChange={e => setProfileDescription(e.target.value)}
          disabled={profilesLoading}
        />
        <button
          type="button"
          className="app-btn"
          style={{ ...S.btn, opacity: autoDetectLoading ? 0.6 : 1 }}
          disabled={autoDetectLoading || profiles.length === 0}
          onClick={handleAutoDetectProfile}
          title="Uses the Job description box below to pick which saved profile fits best"
        >
          {autoDetectLoading ? '…' : 'Auto-detect'}
        </button>
        <button type="button" className="app-btn" style={S.btn} onClick={handleNewProfile} disabled={profilesLoading}>
          New profile
        </button>
        <button type="button" className="app-btn app-btn-primary" style={S.btnPrimary} onClick={handleSaveProfile} disabled={profilesLoading}>
          Save
        </button>
        <button
          type="button"
          className="app-btn"
          style={{ ...S.btn, opacity: activeProfileSlug ? 1 : 0.45 }}
          disabled={!activeProfileSlug}
          onClick={handleDeleteProfile}
        >
          Delete
        </button>
      </div>
      {profileNotice && (
        <div
          style={{
            padding: '6px 14px',
            fontSize: 12,
            color: profileNoticePositive ? '#86efac' : '#a8b3cc',
            borderBottom: '1px solid rgba(99, 102, 241, 0.1)',
            background: profileNoticePositive ? 'rgba(34, 197, 94, 0.08)' : '#11111d',
          }}
        >
          {profileNotice}
        </div>
      )}

      <div style={{
        padding: '8px 14px 6px',
        fontSize: 11,
        color: '#7c8498',
        lineHeight: 1.5,
        borderBottom: '1px solid rgba(99, 102, 241, 0.08)',
        background: '#0e0e18',
      }}>
        Profiles store your resume variants long-term. Paste each company’s job posting only in <strong style={{ color: '#a8b3cc', fontWeight: 600 }}>Job description</strong> below — it stays in this browser session and is not saved with your profile.
      </div>

      {/* JD Bar */}
      <div style={{ ...S.jdBar, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 12, color: labelMuted, whiteSpace: 'nowrap', paddingTop: 9, fontWeight: 600 }} title="Not saved — paste a fresh posting per application">
          Job description
        </span>
        <textarea
          style={S.jdInput}
          rows={4}
          placeholder="Paste this employer’s posting here for this application only (not saved). Pick the resume profile above, then Suggest."
          value={jdText}
          onChange={e => setJdText(e.target.value)}
        />
        <button
          type="button"
          className="app-btn app-btn-primary"
          style={{
            ...S.btnPrimary,
            alignSelf: 'flex-start',
            marginTop: 2,
            minWidth: 108,
            opacity:
              suggestStatus === 'loading' || !activeProfileSlug || !jdText.trim()
                ? 0.55
                : 1,
          }}
          disabled={
            suggestStatus === 'loading' || !activeProfileSlug || !jdText.trim()
          }
          onClick={handleSuggest}
          title={
            !activeProfileSlug
              ? 'Select or create a resume profile first'
              : !jdText.trim()
                ? 'Paste the job description for this application'
                : 'Run AI suggestions for this profile + JD'
          }
        >
          {suggestStageLabel}
        </button>
        {atsScore != null && jdText.trim() && activeProfileSlug && (
          <button
            type="button"
            className="app-btn"
            style={{
              ...S.btn,
              alignSelf: 'flex-start',
              marginTop: 2,
              minWidth: 108,
              opacity: suggestStatus === 'loading' ? 0.55 : 1,
            }}
            disabled={suggestStatus === 'loading'}
            onClick={handleSuggestAgain}
            title="Re-score the current resume against this job description"
          >
            Suggest again
          </button>
        )}
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

      {experienceGap && suggestStatus === 'done' && (
        <div style={{
          padding: '6px 14px',
          background: 'rgba(251, 191, 36, 0.08)',
          color: '#fcd34d',
          borderBottom: '1px solid rgba(251, 191, 36, 0.2)',
          fontSize: 12,
          flexShrink: 0,
          lineHeight: 1.5,
        }}>
          Experience alignment is low ({scoreBreakdown.experience_alignment}/100) — this role may
          expect seniority or scope your resume does not yet show. Keyword edits help, but may not
          push fit above ~80. Consider mid-level or new-grad AI roles, or reframe projects/experience manually.
        </div>
      )}

      {reSuggestOffer && (
        <div style={{
          padding: '6px 14px',
          background: 'rgba(74, 222, 128, 0.08)',
          color: '#86efac',
          borderBottom: '1px solid rgba(74, 222, 128, 0.2)',
          fontSize: 12,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}>
          <span>Suggestions applied and compiled. Re-score your updated resume against this job description?</span>
          <button
            type="button"
            className="app-btn app-btn-primary"
            style={{ ...S.btnPrimary, padding: '4px 12px', fontSize: 11 }}
            disabled={suggestStatus === 'loading'}
            onClick={handleSuggestAgain}
          >
            Suggest again
          </button>
          <button
            type="button"
            className="app-btn"
            style={{ ...S.btn, padding: '4px 10px', fontSize: 11 }}
            onClick={() => setReSuggestOffer(false)}
          >
            Dismiss
          </button>
        </div>
      )}

      {jdSummary && suggestStatus === 'done' && pendingCount > 0 && (
        <div style={{
          padding: '6px 14px',
          fontSize: 11,
          color: '#9ca8c9',
          borderBottom: '1px solid rgba(99, 102, 241, 0.08)',
          background: '#0e0e18',
          flexShrink: 0,
          lineHeight: 1.45,
        }}>
          <strong style={{ color: '#a8b3cc', fontWeight: 600 }}>Role summary:</strong> {jdSummary}
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
        activeProfileName={activeProfileSlug ? activeProfileName : undefined}
        fileName={fileName}
        lastCompileTime={lastCompileTime}
        pendingCount={pendingCount}
        acceptedCount={acceptedCount}
        rejectedCount={rejectedCount}
        baselineAts={baselineAts}
        atsScore={atsScore}
        projectedScore={projectedScore}
        scoreBreakdown={scoreBreakdown}
        personaActive={personaActive}
        personaSource={personaInfo.source}
        personaChars={personaInfo.chars}
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
          onApplyAll={handleApplyAll}
          onClose={() => setPopupState(null)}
        />
      )}
    </div>
  );
}
