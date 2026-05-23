import { useState, useCallback } from 'react';

export function useSuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [atsScore, setAtsScore] = useState(null);
  const [scoreBreakdown, setScoreBreakdown] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'done' | 'error'
  const [error, setError] = useState(null);
  const [progressStage, setProgressStage] = useState(null);

  const fetch = useCallback(async (resumeTex, jobDescription) => {
    setStatus('loading');
    setError(null);
    setAtsScore(null);
    setScoreBreakdown(null);
    setProgressStage('loading');
    try {
      const res = await window.fetch('/api/suggest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ resumeTex, jobDescription }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setAtsScore(data.atsScore ?? null);
      setScoreBreakdown(data.scoreBreakdown ?? null);
      setProgressStage('done');
      if ((data.suggestions ?? []).length === 0) {
        setError('No suggestions returned — try again or paste a shorter job description.');
        setStatus('error');
        return;
      }
      setStatus('done');
    } catch (err) {
      const message = err instanceof TypeError
        ? 'Cannot reach backend on :3002. Start it with `cd resume-editor/backend && npm run dev`'
        : (err?.message ?? String(err));
      setError(message);
      setProgressStage(null);
      setStatus('error');
    }
  }, []);

  const dismiss = useCallback((idx) => {
    setSuggestions(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const dismissAll = useCallback(() => setSuggestions([]), []);

  const pendingCount = suggestions.length;

  return {
    suggestions,
    atsScore,
    scoreBreakdown,
    status,
    error,
    progressStage,
    fetch,
    dismiss,
    dismissAll,
    pendingCount,
  };
}
