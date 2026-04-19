import { useMemo } from 'react';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'are', 'from', 'our',
  'you', 'your', 'will', 'have', 'has', 'had', 'not', 'but', 'they',
  'their', 'its', 'was', 'been', 'can', 'may', 'all', 'any', 'new',
  'also', 'who', 'what', 'when', 'where', 'how', 'such', 'than', 'then',
  'into', 'over', 'more', 'must', 'well', 'each', 'both', 'other',
  'about', 'work', 'team', 'role', 'help', 'able', 'use', 'used',
]);

function extractKeywords(text) {
  return new Set(
    text
      .toLowerCase()
      .split(/[\W_]+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  );
}

/**
 * Returns { matched: number, total: number } — how many distinct JD keywords
 * appear in resumeText. Recomputes only when inputs change.
 * Returns null when jdText is empty.
 */
export function useKeywordScore(jdText, resumeText) {
  return useMemo(() => {
    if (!jdText || !jdText.trim()) return null;

    const jdKeywords = extractKeywords(jdText);
    const total = jdKeywords.size;
    if (total === 0) return null;

    const resumeLower = resumeText.toLowerCase();
    let matched = 0;
    for (const kw of jdKeywords) {
      if (resumeLower.includes(kw)) matched++;
    }

    return { matched, total };
  }, [jdText, resumeText]);
}
