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

export const MAX_SUGGESTIONS_RETURNED = 12;

// ── LaTeX special-character sanitiser ────────────────────────────────────────
// The most common failure path is: AI returns content like "C#", "R&D", "Node_js",
// or "+30%" verbatim. pdflatex then chokes with errors like:
//   ! You can't use `macro parameter character #' in horizontal mode.
//   ! Missing $ inserted. (for unescaped _)
// We escape the four characters that almost always appear unescaped in
// AI-generated resume content: # & _ %.
//
// Notes:
// - $, ~, ^ are intentionally NOT touched. Resume macros and math blocks
//   use them legitimately and double-escaping breaks valid LaTeX.
// - We respect existing escapes via a "previous char is not a backslash"
//   guard. (?<!\\) lookbehind matches characters whose immediate predecessor
//   is not a single backslash. The `\\#` edge case is rare in resumes.
// - `%` at the start of a line is a comment delimiter and is preserved.

function escapeChar(text: string, char: string, escaped: string, allowLineStart = false): string {
  const re = new RegExp(`(?<!\\\\)${char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`, 'g');
  if (!allowLineStart) {
    return text.replace(re, escaped);
  }
  return text.replace(re, (match, offset, full) => {
    const lineStart = full.lastIndexOf('\n', offset - 1) + 1;
    const beforeOnLine = full.slice(lineStart, offset);
    if (beforeOnLine.trim() === '') return match;
    return escaped;
  });
}

/**
 * Escape unescaped LaTeX specials that commonly appear in AI-generated
 * resume content. Idempotent: already-escaped sequences (\#, \&, \_, \%)
 * are preserved.
 */
export function sanitizeLatexText(text: string): string {
  if (!text) return text;
  let out = text;
  out = escapeChar(out, '#', '\\#');
  out = escapeChar(out, '&', '\\&');
  out = escapeChar(out, '_', '\\_');
  out = escapeChar(out, '%', '\\%', /* allowLineStart */ true);
  return out;
}

/** Apply sanitiseLatexText to the `new` field of each suggestion in-place. */
export function sanitizeSuggestionsForLatex<T extends { new: string; type: string }>(
  suggestions: T[]
): T[] {
  return suggestions.map(s => ({
    ...s,
    new: s.type === 'remove' ? s.new : sanitizeLatexText(s.new),
  }));
}

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
  /\\resumeSubHeadingListStart/,
  /\\resumeSubHeadingListEnd/,
  /\\resumeItemListStart/,
  /\\resumeItemListEnd/,
  /\\begin\{itemize\}/,
  /\\end\{itemize\}/,
  /\\resumeSubheading\b/,
  /\\resumeProjectHeading\b/,
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

const STRUCTURAL_MACROS = [
  /\\resumeSubHeadingListStart/,
  /\\resumeSubHeadingListEnd/,
  /\\resumeItemListStart/,
  /\\resumeItemListEnd/,
  /\\begin\{itemize\}/,
  /\\end\{itemize\}/,
  /\\resumeSubheading\b/,
  /\\resumeProjectHeading\b/,
];

function containsStructuralMacro(text: string): boolean {
  return STRUCTURAL_MACROS.some(p => p.test(text));
}

const ITEM_LIST_OPEN = [
  /\\begin\{itemize\}/,
  /\\resumeItemListStart/,
];

const ITEM_LIST_CLOSE = [
  /\\end\{itemize\}/,
  /\\resumeItemListEnd/,
];

const ITEM_COMMAND = /\\item\b/;

function hasItemCommand(text: string): boolean {
  return ITEM_COMMAND.test(text);
}

function hasListOpen(text: string): boolean {
  return ITEM_LIST_OPEN.some((p) => p.test(text));
}

function hasListClose(text: string): boolean {
  return ITEM_LIST_CLOSE.some((p) => p.test(text));
}

/**
 * For each source line, marks whether the line is currently inside an itemized
 * list environment (`itemize` or resumeItemList* macros).
 */
export function buildItemizeMap(resumeLines: string[]): boolean[] {
  const inside: boolean[] = new Array(resumeLines.length).fill(false);
  let depth = 0;

  for (let i = 0; i < resumeLines.length; i++) {
    const line = resumeLines[i] ?? '';
    // If this line closes a list, it should not be treated as "inside".
    if (hasListClose(line)) {
      depth = Math.max(0, depth - 1);
    }

    inside[i] = depth > 0;

    // A line that opens a list means subsequent lines are "inside".
    if (hasListOpen(line)) {
      depth += 1;
    }
  }

  return inside;
}

function isListContext(line: number, resumeLines: string[], itemizeMap: boolean[]): boolean {
  const idx = line - 1;
  if (idx < 0 || idx >= resumeLines.length) return false;
  const curr = resumeLines[idx] ?? '';
  const prev = idx > 0 ? resumeLines[idx - 1] ?? '' : '';
  const next = idx + 1 < resumeLines.length ? resumeLines[idx + 1] ?? '' : '';

  return (
    itemizeMap[idx] ||
    hasListOpen(curr) ||
    hasListOpen(prev) ||
    (idx > 0 && itemizeMap[idx - 1]) ||
    hasListClose(next)
  );
}

/**
 * Rejects suggestions that would create invalid list markup, such as:
 * - introducing `\item` outside itemize/resumeItemList environments
 * - removing `\item` from a line that is currently inside list context
 */
export function orphanItemRejection(s: Suggestion, resumeLines: string[]): string | null {
  if (s.type === 'remove') return null;
  const hasNewItem = hasItemCommand(s.new);
  const hadOldItem = hasItemCommand(s.old);
  const itemizeMap = buildItemizeMap(resumeLines);
  const inListContext = isListContext(s.line, resumeLines, itemizeMap);

  if (hasNewItem && !inListContext) return 'introduces \\item outside a list environment';
  if (hadOldItem && !hasNewItem && inListContext && s.new.trim().length > 0) {
    return 'removes \\item from list context';
  }

  return null;
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
  const orphanItem = orphanItemRejection(s, resumeLines);
  if (orphanItem) return orphanItem;
  if (s.type !== 'add' && s.type !== 'remove' && !commandsPreserved(s.old, s.new)) {
    return 'command set drifted between old and new';
  }
  if (containsStructuralMacro(s.old)) return 'old text contains a structural macro';
  if (s.type !== 'remove' && containsStructuralMacro(s.new)) return 'new text contains a structural macro';
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
