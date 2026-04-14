import { useRef, useEffect, useCallback } from 'react';
import MonacoEditor, { useMonaco } from '@monaco-editor/react';

// Register LaTeX language once
function registerLatex(monaco) {
  const langs = monaco.languages.getLanguages();
  if (langs.some(l => l.id === 'latex')) return;

  monaco.languages.register({ id: 'latex' });
  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\\[a-zA-Z@]+/, 'keyword'],
        [/\{/, 'delimiter.curly'],
        [/\}/, 'delimiter.curly'],
        [/\[/, 'delimiter.bracket'],
        [/\]/, 'delimiter.bracket'],
        [/\$\$[\s\S]*?\$\$/, 'string.math'],
        [/\$[^$\n]*\$/, 'string.math'],
        [/[0-9]+/, 'number'],
        [/[a-zA-Z\u00C0-\u024F]+/, 'identifier'],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration('latex', {
    comments: { lineComment: '%' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '$', close: '$' },
    ],
  });
  monaco.editor.defineTheme('latex-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
      { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'string.math', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
    ],
    colors: {},
  });
}

export default function Editor({ value, onChange, suggestions, onBadgeClick }) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const widgetsRef = useRef({});
  const decorationsRef = useRef([]);
  const monaco = useMonaco();

  // Group suggestions by line for badge counts
  const getSuggestionsByLine = useCallback(() => {
    const byLine = {};
    suggestions.forEach((s, idx) => {
      const key = s.line;
      if (!byLine[key]) byLine[key] = [];
      byLine[key].push({ ...s, globalIdx: idx });
    });
    return byLine;
  }, [suggestions]);

  const updateWidgets = useCallback(() => {
    const editor = editorRef.current;
    const monacoInstance = monacoRef.current;
    if (!editor || !monacoInstance) return;

    // Remove existing content widgets
    Object.values(widgetsRef.current).forEach(w => editor.removeContentWidget(w));
    widgetsRef.current = {};

    // Remove existing line decorations
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);

    const byLine = getSuggestionsByLine();
    if (Object.keys(byLine).length === 0) return;

    // Add line highlight decorations
    const newDecorations = Object.keys(byLine).map(lineNum => ({
      range: new monacoInstance.Range(Number(lineNum), 1, Number(lineNum), 1),
      options: {
        isWholeLine: true,
        className: 'suggestion-line-highlight',
      },
    }));
    decorationsRef.current = editor.deltaDecorations([], newDecorations);

    // Add content widget badges
    Object.entries(byLine).forEach(([lineNumStr, lineSuggs]) => {
      const lineNumber = Number(lineNumStr);
      const count = lineSuggs.length;
      // Use the global index of the first suggestion on this line for navigation
      const firstGlobalIdx = lineSuggs[0].globalIdx;

      const dom = document.createElement('span');
      dom.className = 'suggestion-badge';
      dom.textContent = `✨ ${count} suggestion${count > 1 ? 's' : ''}`;
      dom.title = 'Click to review suggestion';
      dom.addEventListener('click', (e) => {
        e.stopPropagation();
        onBadgeClick(lineNumber, firstGlobalIdx, e);
      });

      const widget = {
        getId: () => `suggestion-badge-${lineNumber}`,
        getDomNode: () => dom,
        getPosition: () => ({
          position: { lineNumber, column: 9999 },
          preference: [monacoInstance.editor.ContentWidgetPositionPreference.AFTER],
        }),
      };

      editor.addContentWidget(widget);
      widgetsRef.current[lineNumber] = widget;
    });
  }, [getSuggestionsByLine, onBadgeClick]);

  useEffect(() => {
    if (monacoRef.current && editorRef.current) {
      updateWidgets();
    }
  }, [updateWidgets]);

  function handleMount(editor, monacoInstance) {
    editorRef.current = editor;
    monacoRef.current = monacoInstance;
    registerLatex(monacoInstance);
    editor.updateOptions({ language: 'latex' });
    updateWidgets();
  }

  return (
    <>
      <style>{`
        .suggestion-line-highlight {
          background: rgba(255, 220, 0, 0.06);
          border-left: 2px solid #ffd700;
        }
        .suggestion-badge {
          display: inline-flex;
          align-items: center;
          padding: 1px 8px;
          margin-left: 12px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          background: rgba(255, 215, 0, 0.2);
          color: #ffd700;
          border: 1px solid rgba(255, 215, 0, 0.4);
          white-space: nowrap;
          vertical-align: middle;
          line-height: 1.6;
          transition: background 0.15s;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .suggestion-badge:hover {
          background: rgba(255, 215, 0, 0.35);
        }
      `}</style>
      <MonacoEditor
        height="100%"
        defaultLanguage="plaintext"
        value={value}
        onChange={onChange}
        theme="vs-dark"
        onMount={handleMount}
        options={{
          fontSize: 14,
          lineNumbers: 'on',
          minimap: { enabled: false },
          wordWrap: 'on',
          folding: true,
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'on',
          padding: { top: 12, bottom: 12 },
        }}
      />
    </>
  );
}
