// Stage 1 — Reasoning: audit the resume against the JD and emit a plan.
//
// Uses DeepSeek-V4-Pro with thinking mode enabled (the highest-reasoning
// model in DeepSeek's lineup, per https://api-docs.deepseek.com).
// Falls back to OpenAI if DEEPSEEK_API_KEY is not configured.

import {
  MODELS,
  getDeepSeek,
  getOpenAI,
  isDeepSeekConfigured,
} from './clients';
import { isProtectedLine } from '../suggestPipeline';

export interface PlanItem {
  type: 'reframe' | 'quantify' | 'keyword' | 'restructure' | 'add' | 'remove';
  priority: 'high' | 'medium' | 'low';
  section: string;
  line: number;
  old: string;
  intent: string;
  reason: string;
  jd_keywords_addressed: string[];
}

export interface ReasoningOutput {
  atsScore: number;
  scoreBreakdown: {
    keyword_coverage: number;
    experience_alignment: number;
    skills_match: number;
    formatting_ats_safety: number;
  };
  jdSummary: string;
  plan: PlanItem[];
  model: string;
}

const SYSTEM_PROMPT = `You are a senior career strategist and ATS auditor.
Your job: read a job description, audit a LaTeX resume against it, and
emit a structured PLAN of changes. You do NOT write the final wording —
a separate writing model handles that. Focus on *what* and *why*, not
*how it should read*. When a PERSONA block is provided, use it to set the
quality bar (e.g. if the persona mandates the XYZ format with metrics,
flag any bullet that lacks a number as a "quantify" target).`;

function buildUserPrompt(
  numberedResume: string,
  jobDescription: string,
  maxPlanItems: number,
  persona: string
): string {
  const personaBlock = persona
    ? `=== USER PERSONA (use this to set the bar for each plan item's intent) ===
${persona}
=== END PERSONA ===

`
    : '';

  return `${personaBlock}=== JOB DESCRIPTION ===
${jobDescription}

=== RESUME (LaTeX with line numbers; [PROTECTED] lines must NOT be touched) ===
${numberedResume}

=== TASK ===
1. Summarise the role in one sentence: seniority, role family, top 5 must-have skills.
2. Score the current resume against this JD on four axes (0-100):
   keyword_coverage, experience_alignment, skills_match, formatting_ats_safety.
3. Produce a PLAN of at most ${maxPlanItems} high-impact changes.
   For each plan item, output:
     - type: reframe | quantify | keyword | restructure | add | remove
     - priority: high | medium | low
     - section: which resume section
     - line: 1-based line number (use the exact "old" line's number; for "add", the line above where it should go)
     - old: EXACT original line text (character-for-character, excluding the "N: " prefix and the [PROTECTED] marker). For "add", set old="".
     - intent: one short sentence describing what the rewrite must achieve (do NOT write the final bullet)
     - reason: why this helps for this JD
     - jd_keywords_addressed: list of JD keywords this change covers

=== HARD RULES ===
- Never plan a change on a [PROTECTED] line.
- Never plan to mutate section headings (\\section*, \\subsection*).
- Never touch structural macros (\\begin{itemize}, \\end{itemize}, \\resumeSubHeadingListStart, etc.).
- The "intent" field describes the *goal* of the rewrite, not the rewritten text.
- Be conservative: only plan changes that materially improve ATS / fit.

=== OUTPUT (return ONLY this JSON) ===
{
  "jdSummary": "...",
  "atsScore": <weighted: keyword_coverage*0.30 + experience_alignment*0.35 + skills_match*0.25 + formatting_ats_safety*0.10>,
  "scoreBreakdown": {
    "keyword_coverage": <0-100>,
    "experience_alignment": <0-100>,
    "skills_match": <0-100>,
    "formatting_ats_safety": <0-100>
  },
  "plan": [
    {
      "type": "...",
      "priority": "...",
      "section": "...",
      "line": <int>,
      "old": "...",
      "intent": "...",
      "reason": "...",
      "jd_keywords_addressed": ["..."]
    }
  ]
}`;
}

function numberResume(resumeTex: string): string {
  return resumeTex
    .split('\n')
    .map((line, i) => {
      const prefix = `${i + 1}: `;
      const marker = isProtectedLine(line) ? ' [PROTECTED]' : '';
      return `${prefix}${line}${marker}`;
    })
    .join('\n');
}

export async function runReasoningStage(
  resumeTex: string,
  jobDescription: string,
  persona = '',
  maxPlanItems = 15
): Promise<ReasoningOutput> {
  const numberedResume = numberResume(resumeTex);
  const userPrompt = buildUserPrompt(numberedResume, jobDescription, maxPlanItems, persona);

  const useDeepSeek = isDeepSeekConfigured();
  const client = useDeepSeek ? getDeepSeek() : getOpenAI();
  const model = useDeepSeek ? MODELS.reasoning : MODELS.writing;

  const personaHint = persona ? `persona=${persona.length}ch` : 'persona=OFF';
  console.log(`[reasoning] model=${model} provider=${useDeepSeek ? 'deepseek' : 'openai'} ${personaHint}`);
  const start = Date.now();

  // DeepSeek-specific knobs (thinking mode + high reasoning effort) are
  // attached via an `any` cast so the OpenAI SDK accepts the unknown fields.
  // OpenAI ignores unknown body fields, so this is safe in both cases.
  const baseParams: Record<string, unknown> = {
    model,
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  };
  if (useDeepSeek) {
    baseParams.reasoning_effort = 'high';
    baseParams.thinking = { type: 'enabled' };
  }

  let raw = '';
  try {
    const response = await client.chat.completions.create(
      baseParams as unknown as Parameters<typeof client.chat.completions.create>[0]
    );
    // Non-streaming response; cast away the streaming union.
    raw = (response as { choices: Array<{ message?: { content?: string } }> })
      .choices[0]?.message?.content ?? '{}';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If DeepSeek fails (e.g. model name unknown), fall back to OpenAI on the
    // same prompt. This keeps the pipeline alive when only one provider is healthy.
    if (useDeepSeek) {
      console.warn(`[reasoning] DeepSeek failed (${msg}); falling back to OpenAI`);
      const openai = getOpenAI();
      const response = await openai.chat.completions.create({
        model: MODELS.writing,
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });
      raw = (response as { choices: Array<{ message?: { content?: string } }> })
        .choices[0]?.message?.content ?? '{}';
    } else {
      throw err;
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[reasoning] completed in ${elapsed}s`);

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[reasoning] failed to parse JSON output');
  }

  const atsScore = typeof parsed.atsScore === 'number' ? parsed.atsScore : 0;
  const breakdown = (parsed.scoreBreakdown ?? {}) as Record<string, number>;
  const planRaw = Array.isArray(parsed.plan) ? parsed.plan : [];

  const plan: PlanItem[] = planRaw
    .map((item) => {
      const p = item as Record<string, unknown>;
      return {
        type: String(p.type ?? 'keyword') as PlanItem['type'],
        priority: String(p.priority ?? 'medium') as PlanItem['priority'],
        section: String(p.section ?? 'Resume'),
        line: typeof p.line === 'number' ? p.line : 0,
        old: String(p.old ?? ''),
        intent: String(p.intent ?? ''),
        reason: String(p.reason ?? ''),
        jd_keywords_addressed: Array.isArray(p.jd_keywords_addressed)
          ? (p.jd_keywords_addressed as unknown[]).map(String)
          : [],
      };
    })
    .filter((p) => p.intent.length > 0 && (p.old.length > 0 || p.type === 'add'));

  return {
    atsScore,
    scoreBreakdown: {
      keyword_coverage: breakdown.keyword_coverage ?? 0,
      experience_alignment: breakdown.experience_alignment ?? 0,
      skills_match: breakdown.skills_match ?? 0,
      formatting_ats_safety: breakdown.formatting_ats_safety ?? 0,
    },
    jdSummary: typeof parsed.jdSummary === 'string' ? parsed.jdSummary : '',
    plan,
    model,
  };
}
