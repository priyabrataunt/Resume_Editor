// Pure suggestion validation, reconciliation, and ranking — unit-tested.

export interface Suggestion {
  type: 'reframe' | 'quantify' | 'keyword' | 'restructure' | 'add' | 'remove';
  priority: 'high' | 'medium' | 'low';
  section: string;
  line: number;
  old: string;
  new: string;
  reason: string;
  jd_keywords_addressed: string[];
}

export const MAX_SUGGESTIONS_RETURNED = 10;

const PROTECTED_PATTERNS = [
  /^\\section\*?\{/,
  /^\\subsection\*?\{/,
  /^\\begin\{document\}/,
  /^\\end\{document\}/,
  /^\\documentclass/,
  /^\\usepackage/,
  /^\\input\{/,
  /^\\newcommand/,
  /^\\renewcommand/,
  /^\\def\\/,
];

export function isProtectedLine(line: string): boolean {
  const trimmed = line.trim();
  return PROTECTED_PATTERNS.some(p => p.test(trimmed));
}

export function isBraceBalanced(str: string): boolean {
  let depth = 0;
  for (const ch of str) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export function extractCommands(str: string): string[] {
  const matches = str.match(/\\[a-zA-Z]+\*?/g) ?? [];
  return matches.sort();
}

export function commandsPreserved(oldStr: string, newStr: string): boolean {
  const a = extractCommands(oldStr);
  const b = extractCommands(newStr);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Returns a rejection reason string, or null if the suggestion passes structural checks. */
export function suggestionRejection(s: Suggestion, resumeLines: string[]): string | null {
  if (s.line > 0 && s.line <= resumeLines.length && isProtectedLine(resumeLines[s.line - 1])) {
    return 'targets a protected line';
  }
  if (/\\section\*?\{/.test(s.old)) {
    const oldHeading = s.old.match(/\\section\*?\{(.+?)\}/)?.[1];
    const newHeading = s.new.match(/\\section\*?\{(.+?)\}/)?.[1];
    if (oldHeading !== newHeading) return 'mutates a section heading';
  }
  if (s.type !== 'remove' && !isBraceBalanced(s.new)) return 'unbalanced braces in new';
  if (s.type !== 'add' && s.type !== 'remove' && !commandsPreserved(s.old, s.new)) {
    return 'command set drifted between old and new';
  }
  return null;
}

export function partitionSuggestions(
  suggestions: Suggestion[],
  resumeLines: string[]
): { passed: Suggestion[]; rejected: Array<{ s: Suggestion; reason: string }> } {
  const passed: Suggestion[] = [];
  const rejected: Array<{ s: Suggestion; reason: string }> = [];
  for (const s of suggestions) {
    const reason = suggestionRejection(s, resumeLines);
    if (reason) rejected.push({ s, reason });
    else passed.push(s);
  }
  return { passed, rejected };
}

export function validateSuggestions(suggestions: Suggestion[], resumeLines: string[]): Suggestion[] {
  return partitionSuggestions(suggestions, resumeLines).passed;
}

const PRIORITY_RANK: Record<Suggestion['priority'], number> = { high: 0, medium: 1, low: 2 };

export function rankAndCap(suggestions: Suggestion[], cap = MAX_SUGGESTIONS_RETURNED): Suggestion[] {
  return [...suggestions]
    .sort((a, b) => {
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (p !== 0) return p;
      return (b.jd_keywords_addressed?.length ?? 0) - (a.jd_keywords_addressed?.length ?? 0);
    })
    .slice(0, cap);
}

export function reconcileLineNumbers(suggestions: Suggestion[], resumeLines: string[]): Suggestion[] {
  const result: Suggestion[] = [];

  for (const s of suggestions) {
    const oldText = s.old;
    if (!oldText && s.type !== 'add') continue;
    if (!s.new && s.type !== 'remove') continue;

    let lineNum = 0;

    // "add" with empty old: substring match would hit every line via includes('')
    if (s.type === 'add' && !oldText.trim()) {
      lineNum = s.line > 0 && s.line <= resumeLines.length ? s.line : 0;
      if (lineNum === 0) continue;
      result.push({ ...s, line: lineNum });
      continue;
    }

    const exactIdx = resumeLines.findIndex(l => l.includes(oldText));
    if (exactIdx >= 0) {
      lineNum = exactIdx + 1;
    } else {
      const oldFirstLine = oldText.split('\n').find(l => l.trim().length > 0) ?? oldText;
      const partialIdx = resumeLines.findIndex(l => l.includes(oldFirstLine.trim()));
      if (partialIdx >= 0) {
        lineNum = partialIdx + 1;
      } else {
        lineNum = s.line > 0 && s.line <= resumeLines.length ? s.line : 0;
      }
    }

    if (lineNum === 0) continue;

    result.push({ ...s, line: lineNum });
  }

  return result;
}
