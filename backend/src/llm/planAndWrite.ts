import {
  MODELS,
  QUALITY_MODE,
  buildOpenAIChatParams,
  getOpenAI,
  getProReasoningEffort,
  isOpenAIConfigured,
} from './clients';
import { isProtectedLine } from '../suggestPipeline';

export type EditType = 'reframe' | 'quantify' | 'keyword' | 'restructure' | 'add' | 'remove';
export type EditPriority = 'high' | 'medium' | 'low';

export interface DraftItem {
  type: EditType;
  priority: EditPriority;
  section: string;
  line: number;
  old: string;
  new: string;
  intent: string;
  reason: string;
  jd_keywords_addressed: string[];
}

export interface PlanAndWriteOutput {
  atsScore: number;
  scoreBreakdown: {
    keyword_coverage: number;
    experience_alignment: number;
    skills_match: number;
    formatting_ats_safety: number;
  };
  jdSummary: string;
  projectedScore: number;
  drafts: DraftItem[];
  model: string;
}

/** Heuristic when the model omits projectedScore — caps bump when experience alignment is weak. */
export function estimateProjectedScore(
  atsScore: number,
  scoreBreakdown: PlanAndWriteOutput['scoreBreakdown'],
  draftCount: number,
  highPriorityCount: number
): number {
  const bump = Math.min(22, highPriorityCount * 4 + Math.max(0, draftCount - highPriorityCount) * 2);
  const expCap = scoreBreakdown.experience_alignment < 50 ? 78 : 95;
  return Math.min(expCap, Math.round(atsScore + bump));
}

const SYSTEM_PROMPT = `You are a resume optimizer. Read the JD, audit the resume,
emit compile-safe LaTeX edits in the user's voice. Return ONLY JSON.

Rules:
- "old" must match the source line character-for-character.
- Preserve LaTeX commands from "old" to "new".
- Escape specials in content: # -> \\#, % -> \\%, & -> \\&, _ -> \\_.
- Never touch [PROTECTED] lines, section headings, or structural macros.
- For remove: set "new" to "". For add: set "old" to "".
- Follow the PERSONA block (in the user message) if present.`;

function trimPersonaForPrompt(persona: string, maxChars = 2200): string {
  if (!persona || persona.length <= maxChars) return persona;
  return `${persona.slice(0, maxChars)}\n\n[Persona truncated for token budget — rules above still apply.]`;
}

function numberResume(resumeTex: string): string {
  return resumeTex
    .split('\n')
    .map((line, i) => {
      const marker = isProtectedLine(line) ? ' [PROTECTED]' : '';
      return `${i + 1}: ${line}${marker}`;
    })
    .join('\n');
}

function buildUserPrompt(
  numberedResume: string,
  jobDescription: string,
  persona: string,
  maxPlanItems: number
): string {
  const personaBlock = persona
    ? `=== PERSONA (this is the user's authentic voice — match it precisely) ===
${persona}
=== END PERSONA ===

PERSONA enforcement (apply to every "new" you emit):
- If the persona defines a bullet template (e.g. XYZ / Action+Tool+Outcome+Metric),
  every "new" bullet MUST follow that template.
- If the persona lists banned words (leveraged, utilized, spearheaded, synergized,
  facilitated, etc.), NEVER use them.
- Prefer the persona's action verbs and required metric/specificity level.
- Keep each "new" to 1-2 lines max.

`
    : '';

  return `${personaBlock}=== JOB DESCRIPTION ===
${jobDescription}

=== RESUME (LaTeX with line numbers) ===
${numberedResume}

=== TASK ===
1. Score the CURRENT resume (before any edits) — set atsScore and scoreBreakdown.
2. Return at most ${maxPlanItems} best edits that improve ATS fit for this JD.
3. Set projectedScore: your estimate of atsScore AFTER all listed drafts are applied
   (be realistic — experience/seniority gaps may cap the ceiling below 90).

For each draft item output:
- type: reframe | quantify | keyword | restructure | add | remove
- priority: high | medium | low
- section: section name
- line: 1-based line number (for add: line above insertion point)
- old: exact original line text (for add: "")
- new: improved LaTeX-safe line
- intent: short goal statement
- reason: why this helps for this JD
- jd_keywords_addressed: list of JD keywords addressed

=== OUTPUT (JSON ONLY) ===
{
  "jdSummary": "...",
  "atsScore": <weighted: keyword_coverage*0.30 + experience_alignment*0.35 + skills_match*0.25 + formatting_ats_safety*0.10>,
  "projectedScore": <0-100 estimate after applying all drafts>,
  "scoreBreakdown": {
    "keyword_coverage": <0-100>,
    "experience_alignment": <0-100>,
    "skills_match": <0-100>,
    "formatting_ats_safety": <0-100>
  },
  "drafts": [
    {
      "type": "...",
      "priority": "...",
      "section": "...",
      "line": <int>,
      "old": "...",
      "new": "...",
      "intent": "...",
      "reason": "...",
      "jd_keywords_addressed": ["..."]
    }
  ]
}`;
}

export async function runPlanAndWriteStage(
  resumeTex: string,
  jobDescription: string,
  persona: string,
  maxPlanItems = 12
): Promise<PlanAndWriteOutput> {
  const trimmedPersona = trimPersonaForPrompt(persona);
  const numberedResume = numberResume(resumeTex);
  const userPrompt = buildUserPrompt(numberedResume, jobDescription, trimmedPersona, maxPlanItems);
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ];

  // Plan+write uses OpenAI only (fast: gpt-5.4-mini; pro: gpt-5.5 + reasoning_effort).
  if (!isOpenAIConfigured()) {
    throw new Error('No LLM provider configured (need OPENAI_API_KEY)');
  }

  const start = Date.now();
  const personaHint = persona ? `persona=${persona.length}ch` : 'persona=OFF';
  const maxOutputTokens = QUALITY_MODE === 'pro' ? 8192 : 4000;
  const reasoningEffort = QUALITY_MODE === 'pro' ? getProReasoningEffort() : undefined;

  async function callOpenAI(preferredModel = MODELS.writing): Promise<{ raw: string; model: string }> {
    const openai = getOpenAI();
    const candidates = [preferredModel, MODELS.writingFallback, 'gpt-4o-mini'].filter(
      (m, i, arr) => arr.indexOf(m) === i
    );
    let lastErr: unknown;
    for (const candidate of candidates) {
      try {
        const response = await openai.chat.completions.create(
          buildOpenAIChatParams({
            model: candidate,
            messages,
            temperature: 0.25,
            maxOutputTokens,
            responseFormat: { type: 'json_object' },
            reasoningEffort:
              candidate === preferredModel || candidate === MODELS.writing
                ? reasoningEffort
                : undefined,
          }) as unknown as Parameters<typeof openai.chat.completions.create>[0]
        );
        const raw =
          (response as { choices: Array<{ message?: { content?: string } }> }).choices[0]?.message
            ?.content ?? '{}';
        return { raw, model: candidate };
      } catch (err) {
        lastErr = err;
        console.warn(
          `[plan-write] OpenAI ${candidate} failed (${err instanceof Error ? err.message : String(err)})`
        );
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  let raw = '{}';
  let actualModel = MODELS.writing;

  const effortHint = reasoningEffort ? ` reasoning_effort=${reasoningEffort}` : '';
  console.log(
    `[plan-write] model=${MODELS.writing} provider=openai${effortHint} ${personaHint}`
  );
  const result = await callOpenAI();
  raw = result.raw;
  actualModel = result.model;

  console.log(`[plan-write] primary completed in ${((Date.now() - start) / 1000).toFixed(1)}s (model=${actualModel})`);

  let parsed: Record<string, unknown> = {};
  let parseFailed = false;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parseFailed = true;
    console.error('[plan-write] failed to parse JSON output');
  }

  let draftsRaw = Array.isArray(parsed.drafts) ? parsed.drafts : [];
  if (parseFailed || draftsRaw.length === 0) {
    throw new Error('Plan+write returned no usable suggestions from any model');
  }

  /* DeepSeek pro path (disabled) — restore from git history if needed:
  async function callDeepSeek(): Promise<{ raw: string; model: string }> { ... }
  if (useDeepSeek) { ... fallback to callOpenAI on failure ... }
  */

  const validTypes = new Set<EditType>([
    'reframe',
    'quantify',
    'keyword',
    'restructure',
    'add',
    'remove',
  ]);
  const validPriorities = new Set<EditPriority>(['high', 'medium', 'low']);
  const drafts: DraftItem[] = draftsRaw
    .map((item) => {
      const d = item as Record<string, unknown>;
      const type = String(d.type ?? 'keyword');
      const priority = String(d.priority ?? 'medium');
      return {
        type: validTypes.has(type as EditType) ? (type as EditType) : 'keyword',
        priority: validPriorities.has(priority as EditPriority)
          ? (priority as EditPriority)
          : 'medium',
        section: String(d.section ?? 'Resume'),
        line: typeof d.line === 'number' ? d.line : 0,
        old: String(d.old ?? ''),
        new: String(d.new ?? ''),
        intent: String(d.intent ?? ''),
        reason: String(d.reason ?? ''),
        jd_keywords_addressed: Array.isArray(d.jd_keywords_addressed)
          ? (d.jd_keywords_addressed as unknown[]).map(String)
          : [],
      };
    })
    .filter((d) => (d.old || d.type === 'add') && (d.new || d.type === 'remove'));

  const score = parsed.scoreBreakdown as Record<string, number> | undefined;
  const scoreBreakdown = {
    keyword_coverage: score?.keyword_coverage ?? 0,
    experience_alignment: score?.experience_alignment ?? 0,
    skills_match: score?.skills_match ?? 0,
    formatting_ats_safety: score?.formatting_ats_safety ?? 0,
  };
  const atsScore = typeof parsed.atsScore === 'number' ? parsed.atsScore : 0;
  const highCount = drafts.filter((d) => d.priority === 'high').length;
  const projectedScore =
    typeof parsed.projectedScore === 'number'
      ? parsed.projectedScore
      : estimateProjectedScore(atsScore, scoreBreakdown, drafts.length, highCount);

  return {
    atsScore,
    scoreBreakdown,
    jdSummary: typeof parsed.jdSummary === 'string' ? parsed.jdSummary : '',
    projectedScore,
    drafts,
    model: actualModel,
  };
}
