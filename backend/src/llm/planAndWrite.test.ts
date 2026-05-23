import { describe, expect, it } from 'vitest';
import { estimateProjectedScore } from './planAndWrite';

describe('estimateProjectedScore', () => {
  it('caps bump when experience alignment is low', () => {
    const projected = estimateProjectedScore(
      58,
      { keyword_coverage: 70, experience_alignment: 42, skills_match: 65, formatting_ats_safety: 90 },
      8,
      5
    );
    expect(projected).toBeLessThanOrEqual(78);
    expect(projected).toBeGreaterThan(58);
  });

  it('allows higher ceiling when experience alignment is strong', () => {
    const projected = estimateProjectedScore(
      72,
      { keyword_coverage: 80, experience_alignment: 75, skills_match: 70, formatting_ats_safety: 95 },
      10,
      6
    );
    expect(projected).toBeGreaterThan(72);
    expect(projected).toBeLessThanOrEqual(95);
  });
});
