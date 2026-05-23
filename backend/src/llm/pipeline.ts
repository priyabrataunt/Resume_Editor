// Multi-model orchestrator: Reasoning → Writing → LaTeX alignment.
//
// Each stage is owned by the best-fit model from a different provider:
//   1. Reasoning  — DeepSeek-V4-Pro (thinking mode)
//   2. Writing    — OpenAI GPT-5.5
//   3. LaTeX safe — Gemini 3.1 Pro (or GPT-5.3-Codex fallback)
//
// The pipeline returns the same `SuggestionResult` shape the existing
// `/api/suggest` endpoint expects, so the frontend keeps working unchanged.

import {
  MAX_SUGGESTIONS_RETURNED,
  rankAndCap,
  reconcileLineNumbers,
  sanitizeSuggestionsForLatex,
  suggestionRejection,
  type Suggestion,
} from '../suggestPipeline';
import { runPlanAndWriteStage, type DraftItem } from './planAndWrite';
import { runLatexStage } from './latex';

export interface PipelineDiagnostics {
  planWriteModel: string;
  latexModel: string;
  personaActive: boolean;
  personaChars: number;
  draftedSize: number;
  alignedSize: number;
  validatedSize: number;
  ms: number;
}

export interface PipelineResult {
  suggestions: Suggestion[];
  atsScore: number;
  projectedScore: number;
  scoreBreakdown: {
    keyword_coverage: number;
    experience_alignment: number;
    skills_match: number;
    formatting_ats_safety: number;
  };
  jdSummary: string;
  diagnostics: PipelineDiagnostics;
}

type CandidateSuggestion = Suggestion & {
  idx: number;
  intent: string;
};

function prepareCandidates(
  drafts: DraftItem[],
  resumeLines: string[]
): {
  reconciled: CandidateSuggestion[];
  passed: CandidateSuggestion[];
  rejected: Array<{ s: CandidateSuggestion; reason: string }>;
} {
  const raw: CandidateSuggestion[] = drafts.map((d, idx) => ({
    idx,
    intent: d.intent,
    type: d.type,
    priority: d.priority,
    section: d.section,
    line: d.line,
    old: d.old,
    new: d.new,
    reason: d.reason,
    jd_keywords_addressed: d.jd_keywords_addressed,
  }));

  const sanitised = sanitizeSuggestionsForLatex(raw);
  const reconciled = reconcileLineNumbers(sanitised, resumeLines) as CandidateSuggestion[];
  const passed: CandidateSuggestion[] = [];
  const rejected: Array<{ s: CandidateSuggestion; reason: string }> = [];
  for (const s of reconciled) {
    const reason = suggestionRejection(s, resumeLines);
    if (reason) rejected.push({ s, reason });
    else passed.push(s);
  }

  return { reconciled, passed, rejected };
}

export async function runSuggestionPipeline(
  resumeTex: string,
  jobDescription: string,
  persona: string
): Promise<PipelineResult> {
  const lines = resumeTex.split('\n');
  const t0 = Date.now();

  const personaChars = persona?.length ?? 0;
  console.log(`[pipeline] starting | persona=${personaChars > 0 ? `${personaChars}ch` : 'OFF'}`);

  const drafted = await runPlanAndWriteStage(resumeTex, jobDescription, persona);
  const initial = prepareCandidates(drafted.drafts, lines);
  let latexModel = 'skipped-local' as string;
  let finalPassed = initial.passed;
  let alignedSize = initial.reconciled.length;

  if (initial.rejected.length > 0) {
    const rejectedIdxSet = new Set(initial.rejected.map((r) => r.s.idx));
    const failingDraftEntries = drafted.drafts
      .map((draft, idx) => ({ draft, idx }))
      .filter((entry) => rejectedIdxSet.has(entry.idx));
    const fixed = await runLatexStage(failingDraftEntries.map((e) => e.draft));
    latexModel = fixed.model;

    const fixedByIdx = new Map<number, DraftItem>();
    for (let i = 0; i < failingDraftEntries.length; i++) {
      const originalIdx = failingDraftEntries[i].idx;
      const aligned = fixed.items[i];
      if (aligned) {
        fixedByIdx.set(originalIdx, {
          type: aligned.type,
          priority: aligned.priority,
          section: aligned.section,
          line: aligned.line,
          old: aligned.old,
          new: aligned.new,
          intent: failingDraftEntries[i].draft.intent,
          reason: aligned.reason,
          jd_keywords_addressed: aligned.jd_keywords_addressed,
        });
      }
    }

    const mergedDrafts = drafted.drafts.map((draft, idx) => fixedByIdx.get(idx) ?? draft);
    const postLatex = prepareCandidates(mergedDrafts, lines);
    finalPassed = postLatex.passed;
    alignedSize = postLatex.reconciled.length;
  }

  const finalSuggestions: Suggestion[] = finalPassed.map((a) => ({
    type: a.type,
    priority: a.priority,
    section: a.section,
    line: a.line,
    old: a.old,
    new: a.new,
    reason: a.reason,
    jd_keywords_addressed: a.jd_keywords_addressed,
  }));

  const ranked = rankAndCap(finalSuggestions, MAX_SUGGESTIONS_RETURNED);

  const diagnostics: PipelineDiagnostics = {
    planWriteModel: drafted.model,
    latexModel,
    personaActive: personaChars > 0,
    personaChars,
    draftedSize: drafted.drafts.length,
    alignedSize,
    validatedSize: ranked.length,
    ms: Date.now() - t0,
  };

  console.log(
    `[pipeline] drafted=${diagnostics.draftedSize} aligned=${diagnostics.alignedSize} validated=${diagnostics.validatedSize} (${diagnostics.ms}ms)`
  );

  return {
    suggestions: ranked,
    atsScore: drafted.atsScore,
    projectedScore: drafted.projectedScore,
    scoreBreakdown: drafted.scoreBreakdown,
    jdSummary: drafted.jdSummary,
    diagnostics,
  };
}
