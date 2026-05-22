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
  validateSuggestions,
  type Suggestion,
} from '../suggestPipeline';
import { runReasoningStage } from './reasoning';
import { runWritingStage } from './writing';
import { runLatexStage } from './latex';

export interface PipelineDiagnostics {
  reasoningModel: string;
  writingModel: string;
  latexModel: string;
  personaActive: boolean;
  personaChars: number;
  planSize: number;
  draftSize: number;
  alignedSize: number;
  validatedSize: number;
  ms: number;
}

export interface PipelineResult {
  suggestions: Suggestion[];
  atsScore: number;
  scoreBreakdown: {
    keyword_coverage: number;
    experience_alignment: number;
    skills_match: number;
    formatting_ats_safety: number;
  };
  jdSummary: string;
  diagnostics: PipelineDiagnostics;
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

  const reasoning = await runReasoningStage(resumeTex, jobDescription, persona);
  const writing = await runWritingStage(reasoning.plan, lines, persona);
  const latex = await runLatexStage(writing.drafts);

  const sanitisedAligned = sanitizeSuggestionsForLatex(latex.items);

  const asSuggestions: Suggestion[] = sanitisedAligned.map((a) => ({
    type: a.type,
    priority: a.priority,
    section: a.section,
    line: a.line,
    old: a.old,
    new: a.new,
    reason: a.reason,
    jd_keywords_addressed: a.jd_keywords_addressed,
  }));

  const reconciled = reconcileLineNumbers(asSuggestions, lines);
  const passed = validateSuggestions(reconciled, lines);
  const ranked = rankAndCap(passed, MAX_SUGGESTIONS_RETURNED);

  const diagnostics: PipelineDiagnostics = {
    reasoningModel: reasoning.model,
    writingModel: writing.model,
    latexModel: latex.model,
    personaActive: personaChars > 0,
    personaChars,
    planSize: reasoning.plan.length,
    draftSize: writing.drafts.length,
    alignedSize: latex.items.length,
    validatedSize: passed.length,
    ms: Date.now() - t0,
  };

  console.log(
    `[pipeline] plan=${diagnostics.planSize} draft=${diagnostics.draftSize} aligned=${diagnostics.alignedSize} validated=${diagnostics.validatedSize} (${diagnostics.ms}ms)`
  );

  return {
    suggestions: ranked,
    atsScore: reasoning.atsScore,
    scoreBreakdown: reasoning.scoreBreakdown,
    jdSummary: reasoning.jdSummary,
    diagnostics,
  };
}
