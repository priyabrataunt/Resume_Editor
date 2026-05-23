import { describe, it, expect } from 'vitest';
import {
  isProtectedLine,
  isBraceBalanced,
  extractCommands,
  commandsPreserved,
  buildItemizeMap,
  orphanItemRejection,
  suggestionRejection,
  partitionSuggestions,
  reconcileLineNumbers,
  rankAndCap,
  sanitizeLatexText,
  sanitizeSuggestionsForLatex,
  MAX_SUGGESTIONS_RETURNED,
  type Suggestion,
} from './suggestPipeline';

function s(partial: Partial<Suggestion> & Pick<Suggestion, 'type' | 'old' | 'new'>): Suggestion {
  return {
    priority: 'medium',
    section: 'Test',
    line: 1,
    reason: '',
    jd_keywords_addressed: [],
    ...partial,
  };
}

describe('isProtectedLine', () => {
  it('detects section and preamble lines', () => {
    expect(isProtectedLine('\\section{Experience}')).toBe(true);
    expect(isProtectedLine('  \\subsection*{Skills}  ')).toBe(true);
    expect(isProtectedLine('\\documentclass{article}')).toBe(true);
    expect(isProtectedLine('\\resumeItem{Built foo}')).toBe(false);
  });
});

describe('isBraceBalanced', () => {
  it('accepts balanced and rejects unbalanced', () => {
    expect(isBraceBalanced('\\item{ok}')).toBe(true);
    expect(isBraceBalanced('{a{b}c}')).toBe(true);
    expect(isBraceBalanced('{')).toBe(false);
    expect(isBraceBalanced('}')).toBe(false);
    expect(isBraceBalanced('{}}')).toBe(false);
  });
});

describe('commandsPreserved', () => {
  it('requires same multiset order of command tokens', () => {
    expect(commandsPreserved('\\item{a}', '\\item{b}')).toBe(true);
    expect(commandsPreserved('\\item{a}', '\\textbf{b}')).toBe(false);
    expect(commandsPreserved('\\resumeItem{x}', '\\resumeItem{y}')).toBe(true);
  });
});

describe('extractCommands', () => {
  it('sorts command names for comparison', () => {
    const a = extractCommands('\\textbf{\\item{x}}');
    expect(a).toEqual(['\\item', '\\textbf'].sort());
  });
});

describe('suggestionRejection', () => {
  const lines = ['\\section{Intro}', '\\resumeItem{Alpha}', '\\resumeItem{Beta}'];

  it('rejects protected targets', () => {
    const r = suggestionRejection(s({ line: 1, old: '\\section{Intro}', new: '\\section{Intro}', type: 'keyword' }), lines);
    expect(r).toBe('targets a protected line');
  });

  it('rejects section heading mutation', () => {
    const r = suggestionRejection(
      s({ line: 1, old: '\\section{Intro}', new: '\\section{Outro}', type: 'reframe' }),
      ['\\resumeItem{ok}']
    );
    expect(r).toBe('mutates a section heading');
  });

  it('rejects unbalanced new', () => {
    const r = suggestionRejection(s({ line: 2, old: '\\resumeItem{Alpha}', new: '\\resumeItem{{', type: 'keyword' }), lines);
    expect(r).toBe('unbalanced braces in new');
  });

  it('rejects command drift', () => {
    const r = suggestionRejection(
      s({ line: 2, old: '\\resumeItem{Alpha}', new: '\\textbf{Alpha}', type: 'keyword' }),
      lines
    );
    expect(r).toBe('command set drifted between old and new');
  });

  it('allows remove with empty new', () => {
    expect(suggestionRejection(s({ line: 2, old: '\\resumeItem{Alpha}', new: '', type: 'remove' }), lines)).toBeNull();
  });

  it('skips command check for add', () => {
    expect(
      suggestionRejection(s({ line: 2, old: '', new: '\\resumeItem{New}', type: 'add' }), lines)
    ).toBeNull();
  });

  it('rejects introducing \\item outside list context', () => {
    const r = suggestionRejection(
      s({ line: 2, old: '\\resumeItem{Alpha}', new: '\\item Built API endpoints', type: 'add' }),
      lines
    );
    expect(r).toBe('introduces \\item outside a list environment');
  });

  it('rejects removing \\item while still in list context', () => {
    const listLines = [
      '\\begin{itemize}',
      '  \\item Built API endpoints',
      '\\end{itemize}',
    ];
    const r = suggestionRejection(
      s({
        line: 2,
        old: '  \\item Built API endpoints',
        new: '  Built API endpoints',
        type: 'keyword',
      }),
      listLines
    );
    expect(r).toBe('removes \\item from list context');
  });
});

describe('itemize environment helpers', () => {
  it('buildItemizeMap marks lines inside itemize and resumeItemList blocks', () => {
    const lines = [
      '\\section{Experience}',
      '\\begin{itemize}',
      '\\item Built A',
      '\\end{itemize}',
      '\\resumeItemListStart',
      '\\item Built B',
      '\\resumeItemListEnd',
    ];
    expect(buildItemizeMap(lines)).toEqual([
      false, // section
      false, // begin line itself
      true,  // item line
      false, // end line
      false, // start macro line itself
      true,  // item line inside resume list
      false, // end macro line
    ]);
  });

  it('orphanItemRejection allows \\item when attached to list opening context', () => {
    const lines = [
      '\\begin{itemize}',
      '% placeholder',
      '\\end{itemize}',
    ];
    const rejection = orphanItemRejection(
      s({
        line: 2,
        old: '% placeholder',
        new: '\\item Added bullet',
        type: 'add',
      }),
      lines
    );
    expect(rejection).toBeNull();
  });
});

describe('partitionSuggestions', () => {
  it('splits passed vs rejected', () => {
    const lines = ['\\section{X}', '\\resumeItem{A}'];
    const list: Suggestion[] = [
      s({ line: 1, old: '\\section{X}', new: '\\section{X}', type: 'keyword' }),
      s({ line: 2, old: '\\resumeItem{A}', new: '\\resumeItem{B}', type: 'keyword' }),
    ];
    const { passed, rejected } = partitionSuggestions(list, lines);
    expect(rejected.some(r => r.reason === 'targets a protected line')).toBe(true);
    expect(passed.some(p => p.old === '\\resumeItem{A}')).toBe(true);
  });
});

describe('reconcileLineNumbers', () => {
  it('maps old substring to correct line', () => {
    const lines = ['a', '\\resumeItem{Target}', 'c'];
    const out = reconcileLineNumbers([s({ line: 99, old: '\\resumeItem{Target}', new: '\\resumeItem{X}', type: 'keyword' })], lines);
    expect(out[0]?.line).toBe(2);
  });

  it('uses model line for add with empty old', () => {
    const lines = ['x', 'y'];
    const out = reconcileLineNumbers([s({ type: 'add', old: '', new: '\\item{z}', line: 2 })], lines);
    expect(out).toHaveLength(1);
    expect(out[0]?.line).toBe(2);
  });
});

describe('sanitizeLatexText', () => {
  it('escapes the unescaped # character (C# bug)', () => {
    expect(sanitizeLatexText('Python, JavaScript, TypeScript, SQL, C#'))
      .toBe('Python, JavaScript, TypeScript, SQL, C\\#');
  });

  it('escapes & (R&D, AT&T)', () => {
    expect(sanitizeLatexText('R&D engineer at AT&T')).toBe('R\\&D engineer at AT\\&T');
  });

  it('escapes _ outside math', () => {
    expect(sanitizeLatexText('used Node_js and PostgreSQL_15')).toBe('used Node\\_js and PostgreSQL\\_15');
  });

  it('escapes inline % (percentages)', () => {
    expect(sanitizeLatexText('Reduced latency by 30%'))
      .toBe('Reduced latency by 30\\%');
  });

  it('preserves % at the start of a line (LaTeX comment)', () => {
    expect(sanitizeLatexText('foo\n% comment\nbar 5%')).toBe('foo\n% comment\nbar 5\\%');
  });

  it('is idempotent on already-escaped strings', () => {
    expect(sanitizeLatexText('C\\#, R\\&D, 30\\%')).toBe('C\\#, R\\&D, 30\\%');
  });

  it('handles empty and undefined-ish inputs', () => {
    expect(sanitizeLatexText('')).toBe('');
  });

  it('does not touch math-mode tokens like $ ~ ^', () => {
    expect(sanitizeLatexText('Cost $5 ~10ms uptime^2')).toBe('Cost $5 ~10ms uptime^2');
  });
});

describe('sanitizeSuggestionsForLatex', () => {
  it('sanitises the new field of each suggestion (skips remove)', () => {
    const input = [
      { type: 'keyword', new: 'used C# and 30%', old: 'used C-Sharp and 0.3' },
      { type: 'remove', new: '', old: 'old text' },
    ];
    const out = sanitizeSuggestionsForLatex(input);
    expect(out[0].new).toBe('used C\\# and 30\\%');
    expect(out[1].new).toBe('');
  });
});

describe('rankAndCap', () => {
  it('sorts by priority then jd keyword count and caps', () => {
    const list: Suggestion[] = [
      s({ priority: 'low', jd_keywords_addressed: ['a', 'b'], old: '1', new: '1', type: 'keyword' }),
      s({ priority: 'high', jd_keywords_addressed: ['x'], old: '2', new: '2', type: 'keyword' }),
      s({ priority: 'high', jd_keywords_addressed: ['x', 'y', 'z'], old: '3', new: '3', type: 'keyword' }),
    ];
    const ranked = rankAndCap(list, 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.old).toBe('3');
    expect(ranked[1]?.old).toBe('2');
  });

  it('default cap matches MAX_SUGGESTIONS_RETURNED', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      s({ priority: 'medium', old: `o${i}`, new: `n${i}`, type: 'keyword' })
    );
    expect(rankAndCap(many).length).toBe(MAX_SUGGESTIONS_RETURNED);
  });
});
