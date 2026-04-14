import { useState, useCallback } from 'react';

export function useSuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'done' | 'error'
  const [error, setError] = useState(null);

  const fetch = useCallback(async (resumeTex, jobDescription) => {
    setStatus('loading');
    setError(null);
    try {
      let res;
      try {
        res = await window.fetch('/api/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumeTex, jobDescription }),
        });
      } catch (networkErr) {
        throw new Error(
          'Cannot reach backend on :3002. Start it with `cd resume-editor/backend && npm run dev`'
        );
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, []);

  const dismiss = useCallback((idx) => {
    setSuggestions(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const dismissAll = useCallback(() => setSuggestions([]), []);

  const pendingCount = suggestions.length;
  const projectedAtsDelta = suggestions.reduce((sum, s) => sum + (s.ats_delta ?? 0), 0);

  return { suggestions, status, error, fetch, dismiss, dismissAll, pendingCount, projectedAtsDelta };
}
