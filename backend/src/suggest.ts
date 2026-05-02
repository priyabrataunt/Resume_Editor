import OpenAI from 'openai';
import {
  type Suggestion,
  MAX_SUGGESTIONS_RETURNED,
  isProtectedLine,
  reconcileLineNumbers,
  validateSuggestions,
  rankAndCap,
} from './suggestPipeline';

export type { Suggestion } from './suggestPipeline';
export { MAX_SUGGESTIONS_RETURNED } from './suggestPipeline';

export interface SuggestionResult {
  suggestions: Suggestion[];
  atsScore: number;
  scoreBreakdown: {
    keyword_coverage: number;
    experience_alignment: number;
    skills_match: number;
    formatting_ats_safety: number;
  };
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set. Add it to backend/.env');
  }
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export async function generateSuggestions(
  resumeTex: string,
  jobDescription: string,
  persona: string
): Promise<SuggestionResult> {
  const openai = getOpenAI();
  const lines = resumeTex.split('\n');

  const numberedResume = lines
    .map((line, i) => {
      const prefix = `${i + 1}: `;
      const marker = isProtectedLine(line) ? ' [PROTECTED]' : '';
      return `${prefix}${line}${marker}`;
    })
    .join('\n');

  const systemPrompt = `You are a resume optimization expert. You analyze job descriptions, audit resumes against them, and generate precise LaTeX-safe suggestions.${persona ? `\n\nWriting voice:\n${persona}` : ''}`;

  const userPrompt = `=== JOB DESCRIPTION ===
${jobDescription}

=== RESUME (LaTeX source with line numbers) ===
${numberedResume}

=== INSTRUCTIONS ===
Perform the following in a single pass:

1. ANALYZE the job description: identify role type, seniority, must-have skills, and ATS keywords.
2. AUDIT the resume against the JD: score keyword coverage (0-100), experience alignment (0-100), skills match (0-100), and formatting ATS safety (0-100).
3. GENERATE the highest-impact suggestions to improve the resume's match to this specific role. You may list many candidates in JSON; the server will keep the top ${MAX_SUGGESTIONS_RETURNED} by priority and JD keyword coverage after validating LaTeX safety.

Suggestion types:
| Type | Use when |
|------|----------|
| reframe | Same content needs a different angle for this role |
| quantify | Bullet is weak/generic — add metrics aligned with JD priorities |
| keyword | JD keyword missing from an otherwise good line — insert naturally |
| restructure | Content needs reordering for this role's priorities |
| add | Missing content the JD expects — add a new bullet or skill |
| remove | Content is irrelevant to this role and dilutes the narrative |

=== CRITICAL RULES ===
- Lines marked [PROTECTED] must NEVER be modified or appear in the "old" field
- "old" must be the EXACT original line text, character-for-character (copy from the resume above, excluding the line number prefix and [PROTECTED] marker)
- "new" must preserve the EXACT same LaTeX commands and structure as "old" — only change the content words (add/remove types: follow same command safety for the line you touch)
- Never introduce LaTeX commands not already present in the original line
- For "remove" type: set "new" to ""
- Each suggestion must reference specific JD keywords it addresses
- Prioritize the most impactful edits first (high priority, more jd_keywords_addressed) — the API returns at most ${MAX_SUGGESTIONS_RETURNED} suggestions after ranking
- Do NOT modify section headings (\\section*, \\subsection*)

=== OUTPUT FORMAT (respond with ONLY this JSON, no other text) ===
{
  "atsScore": <weighted score: keyword_coverage*0.3 + experience_alignment*0.35 + skills_match*0.25 + formatting_ats_safety*0.1>,
  "scoreBreakdown": {
    "keyword_coverage": <0-100>,
    "experience_alignment": <0-100>,
    "skills_match": <0-100>,
    "formatting_ats_safety": <0-100>
  },
  "suggestions": [
    {
      "type": "<reframe|quantify|keyword|restructure|add|remove>",
      "priority": "<high|medium|low>",
      "section": "<which resume section>",
      "line": <1-based line number>,
      "old": "<exact original text>",
      "new": "<improved text with same LaTeX structure>",
      "reason": "<why this change helps, referencing JD requirements>",
      "jd_keywords_addressed": ["keyword1", "keyword2"]
    }
  ]
}`;

  console.log('[suggest] Generating suggestions with GPT-4o-mini...');
  const startTime = Date.now();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[suggest] Response received in ${elapsed}s`);

  const raw = response.choices[0].message.content ?? '{}';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[suggest] Failed to parse response JSON');
    return { suggestions: [], atsScore: 0, scoreBreakdown: { keyword_coverage: 0, experience_alignment: 0, skills_match: 0, formatting_ats_safety: 0 } };
  }

  const atsScore = typeof parsed.atsScore === 'number' ? parsed.atsScore : 0;
  const breakdown = parsed.scoreBreakdown as Record<string, number> | undefined;
  const scoreBreakdown = {
    keyword_coverage: breakdown?.keyword_coverage ?? 0,
    experience_alignment: breakdown?.experience_alignment ?? 0,
    skills_match: breakdown?.skills_match ?? 0,
    formatting_ats_safety: breakdown?.formatting_ats_safety ?? 0,
  };

  let rawSuggestions: unknown[] = [];
  if (Array.isArray(parsed.suggestions)) {
    rawSuggestions = parsed.suggestions;
  } else {
    for (const v of Object.values(parsed)) {
      if (Array.isArray(v)) {
        rawSuggestions = v;
        break;
      }
    }
  }

  const validTypes = new Set(['reframe', 'quantify', 'keyword', 'restructure', 'add', 'remove']);
  const validPriorities = new Set(['high', 'medium', 'low']);

  const suggestions: Suggestion[] = rawSuggestions
    .map((item) => {
      const s = item as Record<string, unknown>;
      return {
        type: validTypes.has(String(s.type)) ? (String(s.type) as Suggestion['type']) : 'keyword',
        priority: validPriorities.has(String(s.priority)) ? (String(s.priority) as Suggestion['priority']) : 'medium',
        section: String(s.section ?? 'Resume'),
        line: typeof s.line === 'number' ? s.line : 0,
        old: String(s.old ?? ''),
        new: String(s.new ?? ''),
        reason: String(s.reason ?? ''),
        jd_keywords_addressed: Array.isArray(s.jd_keywords_addressed)
          ? (s.jd_keywords_addressed as unknown[]).map(String)
          : [],
      };
    })
    .filter(s => (s.old || s.type === 'add') && (s.new || s.type === 'remove'));

  const reconciled = reconcileLineNumbers(suggestions, lines);
  const passed = validateSuggestions(reconciled, lines);
  const ranked = rankAndCap(passed, MAX_SUGGESTIONS_RETURNED);

  console.log(
    `[suggest] ${ranked.length} suggestions returned (raw=${rawSuggestions.length}, validated=${passed.length}, cap=${MAX_SUGGESTIONS_RETURNED})`
  );

  return { suggestions: ranked, atsScore, scoreBreakdown };
}
