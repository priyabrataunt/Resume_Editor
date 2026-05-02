import { describe, it, expect } from 'vitest';
import {
  isProtectedLine,
  isBraceBalanced,
  extractCommands,
  commandsPreserved,
  suggestionRejection,
  partitionSuggestions,
  reconcileLineNumbers,
  rankAndCap,
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
