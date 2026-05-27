// Stage 3 — LaTeX alignment: validate and repair the writer's drafts so that
// every "new" string is structurally compatible with the line it replaces
// AND uses LaTeX-safe text (escaped specials, balanced braces, intact macros).
//
// Default: Gemini 3.1 Pro (preview) — its "vibe coding" strengths make it a
// strong fit for structured-text repair (per https://ai.google.dev/gemini-api/docs/models).
// Fallback: OpenAI gpt-5.3-codex (most capable agentic coding model) when
// GEMINI_API_KEY is not configured.

import {
  MODELS,
  buildOpenAIChatParams,
  getGeminiModel,
  getOpenAI,
  isGeminiConfigured,
} from './clients';
import {
  commandsPreserved,
  isBraceBalanced,
  preserveTrailingClosers,
  sanitizeLatexText,
} from '../suggestPipeline';
import type { DraftItem } from './planAndWrite';

export interface AlignedItem extends DraftItem {
  // model that finalised this item
  alignedBy: string;
}

const SYSTEM_INSTRUCTION = `You are a LaTeX-safety reviewer for resume edits.
Each input pair has an "old" line (current resume LaTeX) and a "new" line
(proposed replacement). Your job is to make sure "new" compiles and slots
into the resume's existing macros without breaking anything.

Hard rules:
1. Preserve the EXACT command structure of "old". If "old" is
   "\\resumeItem{...}", "new" must also be "\\resumeItem{...}". Do NOT
   introduce new commands; do NOT drop existing ones.
2. Escape unescaped LaTeX specials inside content:
     #  → \\#
     %  → \\%   (except when the entire line is a comment)
     &  → \\&
     _  → \\_
   These are by far the most common compile-fail bugs (e.g. "C#" or "30%"
   not escaped).
3. Braces must be balanced on the edited line AND in the full document after the edit.
   Multi-line blocks like \\small{\\item{ ... }} rely on a closing }} line — never
   delete or omit those closers; if "old" ends with one or more }, keep the same
   trailing closers on "new".
4. Do NOT touch structural macros: \\begin/\\end, \\section*, \\subsection*,
   \\resumeSubHeadingListStart/End, \\resumeItemListStart/End,
   \\resumeSubheading, \\resumeProjectHeading.
5. If "old" was empty (type=add) you may emit any single LaTeX-safe line
   that fits the resume.
6. If you cannot fix an item, set "new" to "" and "drop" to true.

Output ONLY this JSON:
{
  "items": [
    {"line": <int>, "old": "...", "new": "<repaired>", "drop": <bool>}
  ]
}`;

function buildUserPayload(drafts: DraftItem[]): string {
  const minimal = drafts.map((d, i) => ({
    idx: i,
    line: d.line,
    type: d.type,
    old: d.old,
    new: d.new,
  }));
  return JSON.stringify(minimal, null, 2);
}

interface RawAlignedItem {
  idx?: number;
  line?: number;
  old?: string;
  new?: string;
  drop?: boolean;
}

function parseRaw(raw: string): RawAlignedItem[] {
  try {
    const obj = JSON.parse(raw) as { items?: unknown };
    if (Array.isArray(obj.items)) return obj.items as RawAlignedItem[];
  } catch {}
  return [];
}

async function callGemini(payload: string): Promise<RawAlignedItem[]> {
  const model = getGeminiModel(MODELS.latex);
  const result = await model.generateContent(
    `${SYSTEM_INSTRUCTION}\n\n=== INPUT ===\n${payload}`
  );
  const text = result.response.text();
  return parseRaw(text);
}

async function callOpenAICodex(payload: string): Promise<RawAlignedItem[]> {
  const openai = getOpenAI();
  const messages = [
    { role: 'system' as const, content: SYSTEM_INSTRUCTION },
    { role: 'user' as const, content: payload },
  ];
  const models = [MODELS.latexFallback, 'gpt-4o-mini'];
  for (const model of models) {
    try {
      const response = await openai.chat.completions.create(
        buildOpenAIChatParams({
          model,
          messages,
          temperature: 0.1,
          maxOutputTokens: 4000,
          responseFormat: { type: 'json_object' },
        }) as unknown as Parameters<typeof openai.chat.completions.create>[0]
      );
      const raw = (response as { choices: Array<{ message?: { content?: string } }> }).choices[0]
        ?.message?.content ?? '{}';
      return parseRaw(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[latex] ${model} failed (${msg})`);
    }
  }
  return [];
}

/**
 * Run the LaTeX-alignment pass. We always finalise with the deterministic
 * sanitiser regardless of LLM output, so the pipeline never returns content
 * that would obviously fail to compile (escaping #, %, &, _).
 */
export async function runLatexStage(drafts: DraftItem[]): Promise<{ items: AlignedItem[]; model: string }> {
  if (drafts.length === 0) {
    return { items: [], model: 'none' };
  }

  const useGemini = isGeminiConfigured();
  const start = Date.now();
  let aligned: RawAlignedItem[] = [];
  let model = useGemini ? MODELS.latex : MODELS.latexFallback;

  console.log(`[latex] model=${model} provider=${useGemini ? 'gemini' : 'openai'} items=${drafts.length}`);

  const payload = buildUserPayload(drafts);
  try {
    aligned = useGemini ? await callGemini(payload) : await callOpenAICodex(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (useGemini) {
      console.warn(`[latex] Gemini failed (${msg}); falling back to OpenAI`);
      try {
        aligned = await callOpenAICodex(payload);
        model = MODELS.latexFallback;
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        console.warn(`[latex] OpenAI fallback also failed (${msg2}); using local sanitiser only`);
      }
    } else {
      console.warn(`[latex] OpenAI failed (${msg}); using local sanitiser only`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[latex] completed in ${elapsed}s`);

  // Merge: prefer LLM-aligned "new" if it passes safety; otherwise sanitise
  // the writer's draft directly. This guarantees we never emit obviously
  // broken LaTeX even when the alignment model is unavailable.
  const byIdx = new Map<number, RawAlignedItem>();
  aligned.forEach((a, i) => {
    const idx = typeof a.idx === 'number' ? a.idx : i;
    byIdx.set(idx, a);
  });

  const items: AlignedItem[] = drafts.map((draft, i) => {
    const a = byIdx.get(i);
    let nextNew = draft.new;

    if (a?.new && !a.drop) {
      let proposed = sanitizeLatexText(String(a.new));
      proposed = preserveTrailingClosers(draft.old, proposed);
      const balanced = isBraceBalanced(proposed);
      const commandsOk =
        draft.type === 'add' || draft.type === 'remove'
          ? true
          : commandsPreserved(draft.old, proposed);
      if (balanced && commandsOk) {
        nextNew = proposed;
      } else {
        nextNew = preserveTrailingClosers(draft.old, sanitizeLatexText(draft.new));
      }
    } else if (a?.drop) {
      nextNew = sanitizeLatexText(draft.new);
    } else {
      nextNew = preserveTrailingClosers(draft.old, sanitizeLatexText(draft.new));
    }

    if (draft.type === 'remove') nextNew = '';

    return { ...draft, new: nextNew, alignedBy: model };
  });

  return { items, model };
}
