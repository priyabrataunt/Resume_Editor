import OpenAI from 'openai';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface Suggestion {
  type: 'reframe' | 'quantify' | 'keyword' | 'restructure' | 'add' | 'remove';
  priority: 'high' | 'medium' | 'low';
  section: string;
  line: number;
  old: string;
  new: string;
  reason: string;
  jd_keywords_addressed: string[];
}

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

// ── OpenAI Client ────────────────────────────────────────────────────────────

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

// ── Heading Protection ───────────────────────────────────────────────────────

const PROTECTED_PATTERNS = [
  /^\\section\*?\{/,
  /^\\subsection\*?\{/,
  /^\\begin\{document\}/,
  /^\\end\{document\}/,
  /^\\documentclass/,
  /^\\usepackage/,
  /^\\input\{/,
  /^\\newcommand/,
  /^\\renewcommand/,
  /^\\def\\/,
];

function isProtectedLine(line: string): boolean {
  const trimmed = line.trim();
  return PROTECTED_PATTERNS.some(p => p.test(trimmed));
}

// ── Post-Validation ──────────────────────────────────────────────────────────

function validateSuggestions(suggestions: Suggestion[], resumeLines: string[]): Suggestion[] {
  return suggestions.filter(s => {
    // Reject if targeting a protected line
    if (s.line > 0 && s.line <= resumeLines.length && isProtectedLine(resumeLines[s.line - 1])) {
      return false;
    }
    // Reject if old contains section headings being changed
    if (/\\section\*?\{/.test(s.old)) {
      const oldHeading = s.old.match(/\\section\*?\{(.+?)\}/)?.[1];
      const newHeading = s.new.match(/\\section\*?\{(.+?)\}/)?.[1];
      if (oldHeading !== newHeading) return false;
    }
    return true;
  });
}

// ── Line Number Reconciliation ───────────────────────────────────────────────

function reconcileLineNumbers(suggestions: Suggestion[], resumeLines: string[]): Suggestion[] {
  const result: Suggestion[] = [];

  for (const s of suggestions) {
    const oldText = s.old;
    if (!oldText && s.type !== 'add') continue;
    if (!s.new && s.type !== 'remove') continue;

    let lineNum = 0;

    // Try exact substring match
    const exactIdx = resumeLines.findIndex(l => l.includes(oldText));
    if (exactIdx >= 0) {
      lineNum = exactIdx + 1;
    } else {
      // Try partial match of first non-empty segment
      const oldFirstLine = oldText.split('\n').find(l => l.trim().length > 0) ?? oldText;
      const partialIdx = resumeLines.findIndex(l => l.includes(oldFirstLine.trim()));
      if (partialIdx >= 0) {
        lineNum = partialIdx + 1;
      } else {
        // Fall back to model-provided line number if valid
        lineNum = s.line > 0 && s.line <= resumeLines.length ? s.line : 0;
      }
    }

    if (lineNum === 0) continue;

    result.push({ ...s, line: lineNum });
  }

  return result;
}

// ── Main Pipeline (Single Call) ──────────────────────────────────────────────

export async function generateSuggestions(
  resumeTex: string,
  jobDescription: string,
  persona: string
): Promise<SuggestionResult> {
  const openai = getOpenAI();
  const lines = resumeTex.split('\n');

  // Build numbered resume with PROTECTED markers
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
3. GENERATE targeted suggestions to improve the resume's match to this specific role.

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
- "new" must preserve the EXACT same LaTeX commands and structure as "old" — only change the content words
- Never introduce LaTeX commands not already present in the original line
- For "remove" type: set "new" to ""
- Each suggestion must reference specific JD keywords it addresses
- Address ALL high-priority gaps — do not artificially cap the count
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

  // Extract ATS score
  const atsScore = typeof parsed.atsScore === 'number' ? parsed.atsScore : 0;
  const breakdown = parsed.scoreBreakdown as Record<string, number> | undefined;
  const scoreBreakdown = {
    keyword_coverage: breakdown?.keyword_coverage ?? 0,
    experience_alignment: breakdown?.experience_alignment ?? 0,
    skills_match: breakdown?.skills_match ?? 0,
    formatting_ats_safety: breakdown?.formatting_ats_safety ?? 0,
  };

  // Extract suggestions array
  let rawSuggestions: unknown[] = [];
  if (Array.isArray(parsed.suggestions)) {
    rawSuggestions = parsed.suggestions;
  } else {
    // Search for any array in the response
    for (const v of Object.values(parsed)) {
      if (Array.isArray(v)) {
        rawSuggestions = v;
        break;
      }
    }
  }

  // Parse and validate suggestion types
  const validTypes = new Set(['reframe', 'quantify', 'keyword', 'restructure', 'add', 'remove']);
  const validPriorities = new Set(['high', 'medium', 'low']);

  const suggestions: Suggestion[] = rawSuggestions
    .map((item) => {
      const s = item as Record<string, unknown>;
      return {
        type: validTypes.has(String(s.type)) ? String(s.type) as Suggestion['type'] : 'keyword',
        priority: validPriorities.has(String(s.priority)) ? String(s.priority) as Suggestion['priority'] : 'medium',
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

  // Reconcile line numbers against actual resume content
  const reconciled = reconcileLineNumbers(suggestions, lines);

  // Post-validate: reject heading mutations and protected line modifications
  const validated = validateSuggestions(reconciled, lines);

  console.log(`[suggest] ${validated.length} suggestions validated (${rawSuggestions.length} raw, ${rawSuggestions.length - validated.length} filtered)`);

  return { suggestions: validated, atsScore, scoreBreakdown };
}
