// Stage 2 — Writing: turn each plan item into a polished, voice-matched bullet.
//
// Uses OpenAI gpt-5.5 (or env-configured equivalent) — the strongest non-reasoning
// model for professional writing per https://developers.openai.com/api/docs/models/all.
// The persona system prompt is layered in to keep the user's voice intact.

import { MODELS, getOpenAI } from './clients';
import type { PlanItem } from './reasoning';

export interface DraftItem extends PlanItem {
  new: string;
}

interface DraftBatch {
  drafts: DraftItem[];
  model: string;
}

const SYSTEM_PROMPT_TEMPLATE = (persona: string) => {
  const personaBlock = persona
    ? `
=== PERSONA (this is the user's authentic voice — match it precisely) ===
${persona}
=== END PERSONA ===

The persona above is the SOURCE OF TRUTH for tone, format, vocabulary, and
the bullet shape. If the persona contains an explicit bullet format (e.g.
"Accomplished X by doing Y, which resulted in Z"), every output bullet you
write must follow that format. If the persona lists banned words, never use
them. If it lists preferred action verbs, prefer them.`
    : `
No persona is configured. Default voice: direct, action-first, quantified,
no corporate fluff.`;

  return `You are the WRITING + PERSONA-CHECK model in a multi-model resume
pipeline. Your single most important job is to rewrite each bullet to match
the user's voice as defined in the PERSONA block below — then double-check
your own output against that persona before emitting it.
${personaBlock}

=== WORKFLOW (do this internally for each plan item) ===
Step A. READ the persona above and extract the bullet template + the
        non-negotiable rules (e.g. quantify everything, XYZ format, banned
        words, mandatory action-verb set).
Step B. DRAFT a candidate "new" bullet that satisfies the plan item's
        "intent" AND the persona template.
Step C. SELF-CHECK against persona, asking:
          * Does it follow the persona's bullet template (e.g. XYZ format)?
          * Does it start with a preferred action verb?
          * Are there any banned words/phrases? If yes, rewrite.
          * Is there a concrete metric or scale where the persona expects one?
          * Does it stay 1-2 lines max?
        If any check fails, REVISE before emitting.
Step D. ENSURE LaTeX safety (rules below).

=== HARD CONSTRAINTS ===
- You DO NOT change line numbers, types, priorities, or "old" text. Only
  fill in the "new" field.
- Keep the EXACT same LaTeX command set and structure as the "old" line.
  Example: if "old" is "\\resumeItem{...}", "new" must also be "\\resumeItem{...}".
- Escape unescaped LaTeX specials inside content: # → \\#, % → \\%, & → \\&,
  _ → \\_. The most common bug is unescaped "C#" or "30%" — always write
  them as "C\\#" and "30\\%".
- For "add" type: emit a self-contained line that fits the surrounding
  section AND the persona template.
- For "remove" type: set "new" to "".`;
};

function buildUserPrompt(plan: PlanItem[], lines: string[]): string {
  const planJson = JSON.stringify(plan, null, 2);
  const contextWindow = 2;
  const contexts = plan.map((item, i) => {
    if (!item.line || item.line < 1 || item.line > lines.length) {
      return `[${i}] line=${item.line}: (no context — line out of range)`;
    }
    const lo = Math.max(0, item.line - 1 - contextWindow);
    const hi = Math.min(lines.length, item.line + contextWindow);
    const ctx = lines
      .slice(lo, hi)
      .map((l, j) => `${lo + j + 1}: ${l}`)
      .join('\n');
    return `[${i}] line=${item.line}\n${ctx}`;
  });

  return `=== PLAN (do not modify the structure of these objects; fill in "new" for each) ===
${planJson}

=== LOCAL CONTEXT for each plan item ===
${contexts.join('\n\n')}

=== OUTPUT (return ONLY this JSON) ===
{
  "drafts": [
    {
      "type": "...",        // copied from plan
      "priority": "...",    // copied from plan
      "section": "...",     // copied from plan
      "line": <int>,        // copied from plan
      "old": "...",         // copied from plan, character-for-character
      "intent": "...",      // copied from plan
      "reason": "...",      // copied from plan
      "jd_keywords_addressed": ["..."],
      "new": "<polished LaTeX-safe replacement>"
    }
  ]
}`;
}

export async function runWritingStage(
  plan: PlanItem[],
  resumeLines: string[],
  persona: string
): Promise<DraftBatch> {
  if (plan.length === 0) return { drafts: [], model: MODELS.writing };

  const openai = getOpenAI();
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE(persona);
  const userPrompt = buildUserPrompt(plan, resumeLines);

  const personaLen = persona?.length ?? 0;
  const personaHint = personaLen > 0 ? `persona=${personaLen}ch` : 'persona=OFF';
  console.log(`[writing] model=${MODELS.writing} items=${plan.length} ${personaHint}`);
  const start = Date.now();

  let response;
  try {
    response = await openai.chat.completions.create({
      model: MODELS.writing,
      temperature: 0.4,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[writing] ${MODELS.writing} failed (${msg}); retrying with gpt-4o`);
    response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.4,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[writing] completed in ${elapsed}s`);

  const raw = response.choices[0]?.message?.content ?? '{}';
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[writing] failed to parse JSON output');
  }

  const draftsRaw = Array.isArray(parsed.drafts) ? parsed.drafts : [];

  const drafts: DraftItem[] = draftsRaw
    .map((item) => {
      const d = item as Record<string, unknown>;
      return {
        type: String(d.type ?? 'keyword') as PlanItem['type'],
        priority: String(d.priority ?? 'medium') as PlanItem['priority'],
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

  return { drafts, model: response.model ?? MODELS.writing };
}
