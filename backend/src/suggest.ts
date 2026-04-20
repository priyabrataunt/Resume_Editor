import OpenAI from 'openai';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface JDProfile {
  role_archetype: string;
  seniority: string;
  must_have_skills: { skill: string; frequency: number; context: string }[];
  nice_to_have_skills: { skill: string; frequency: number; context: string }[];
  key_responsibilities: string[];
  ats_keywords: string[];
  domain: string;
  culture_signals: string[];
}

export interface AuditReport {
  ats_readiness_score: number;
  score_breakdown: {
    keyword_coverage: number;
    experience_alignment: number;
    skills_match: number;
    formatting_ats_safety: number;
  };
  section_alignment: { section: string; alignment: string; notes: string }[];
  missing_content: { what: string; why: string; priority: string }[];
  framing_mismatches: { line: number; current_framing: string; jd_framing: string; priority: string }[];
  weak_bullets: { line: number; issue: string; priority: string }[];
  strategic_recommendations: string[];
}

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
  scoreBreakdown: AuditReport['score_breakdown'];
}

// ── DeepSeek Client ───────────────────────────────────────────────────────────

let _deepseek: OpenAI | null = null;
function getDeepSeek(): OpenAI {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not set. Add it to backend/.env');
  }
  if (!_deepseek) {
    _deepseek = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    });
  }
  return _deepseek;
}

// ── Stage 1: JD Deep Analysis (DeepSeek V3) ──────────────────────────────────

async function analyzeJobDescription(jobDescription: string): Promise<JDProfile> {
  const deepseek = getDeepSeek();

  const response = await deepseek.chat.completions.create({
    model: 'deepseek-chat',
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a job description analysis expert. Extract structured information from job descriptions with precision.',
      },
      {
        role: 'user',
        content: `Analyze this job description and extract structured information.

Job Description:
${jobDescription}

---

Extract the following and respond with this exact JSON structure:
{
  "role_archetype": "The core role type (e.g. 'Backend Engineer', 'DevOps/SRE', 'Frontend Developer', 'Full-Stack Engineer', 'Data Engineer', 'ML Engineer', 'Platform Engineer')",
  "seniority": "Junior | Mid | Senior | Staff | Principal — infer from language cues like 'lead', 'mentor', 'architect' (senior+) vs 'assist', 'learn', 'support' (junior)",
  "must_have_skills": [
    { "skill": "exact skill name", "frequency": 3, "context": "how it's used in the role" }
  ],
  "nice_to_have_skills": [
    { "skill": "exact skill name", "frequency": 1, "context": "how it's used" }
  ],
  "key_responsibilities": ["What the person will actually DO day-to-day"],
  "ats_keywords": ["Every keyword an ATS would scan for, including common variants — e.g. both 'CI/CD' and 'continuous integration', both 'K8s' and 'Kubernetes'"],
  "domain": "Industry/domain (e.g. 'fintech', 'healthcare', 'e-commerce', 'SaaS', 'enterprise')",
  "culture_signals": ["Culture indicators from the JD (e.g. 'fast-paced', 'remote-first', 'collaborative')"]
}

Rules:
- must_have_skills: skills in requirements/qualifications section or mentioned 2+ times
- nice_to_have_skills: skills in "bonus"/"preferred" section or mentioned only once
- frequency: count how many times each skill appears in the JD
- ats_keywords: include ALL technology names, methodologies, certifications, and their common abbreviations/variants
- Be exhaustive with ats_keywords — miss nothing an ATS might scan for`,
      },
    ],
  });

  const raw = response.choices[0].message.content ?? '{}';
  const parsed = JSON.parse(raw) as JDProfile;
  return parsed;
}

// ── Stage 2: Resume Gap Audit (DeepSeek R1) ───────────────────────────────────

async function auditResume(
  jdProfile: JDProfile,
  resumeTex: string
): Promise<AuditReport> {
  const deepseek = getDeepSeek();
  const lines = resumeTex.split('\n');
  const numberedResume = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');

  const response = await deepseek.chat.completions.create({
    model: 'deepseek-reasoner',
    max_tokens: 6000,
    messages: [
      {
        role: 'user',
        content: `You are a resume audit expert. Analyze how well this resume matches the target role.

## Target Role Analysis
${JSON.stringify(jdProfile, null, 2)}

## Resume (LaTeX source with line numbers)
${numberedResume}

---

Perform a thorough gap analysis and produce an ATS readiness score. Respond with this exact JSON structure:

{
  "ats_readiness_score": 62,
  "score_breakdown": {
    "keyword_coverage": 55,
    "experience_alignment": 70,
    "skills_match": 65,
    "formatting_ats_safety": 80
  },
  "section_alignment": [
    {
      "section": "Experience",
      "alignment": "strong | partial | weak | missing",
      "notes": "Specific explanation of how this section maps to the JD priorities"
    }
  ],
  "missing_content": [
    {
      "what": "What's missing",
      "why": "Why it matters for this specific role",
      "priority": "high | medium | low"
    }
  ],
  "framing_mismatches": [
    {
      "line": 34,
      "current_framing": "How the resume describes this work",
      "jd_framing": "How the JD frames this kind of work",
      "priority": "high | medium | low"
    }
  ],
  "weak_bullets": [
    {
      "line": 42,
      "issue": "What's wrong with this bullet — generic, no metrics, irrelevant, etc.",
      "priority": "high | medium | low"
    }
  ],
  "strategic_recommendations": [
    "High-level strategic advice like 'reorder sections', 'add a summary', 'promote relevant experience'"
  ]
}

## Scoring Guidelines
- keyword_coverage (0-100): What percentage of the must-have JD keywords appear in the resume?
- experience_alignment (0-100): How well does the described experience map to the JD's key responsibilities?
- skills_match (0-100): How well does the Skills section cover the JD requirements?
- formatting_ats_safety (0-100): Will the LaTeX structure parse cleanly through an ATS? (tables, columns, images hurt)
- ats_readiness_score: weighted average — keyword_coverage * 0.3 + experience_alignment * 0.35 + skills_match * 0.25 + formatting_ats_safety * 0.1

## Rules
- Be specific about line numbers when flagging framing mismatches and weak bullets
- Compare the resume's language against the JD's language — flag when the candidate uses different terminology for the same concept
- missing_content should identify things the JD expects that the resume doesn't mention AT ALL
- strategic_recommendations should be high-level (reorder, restructure, add sections) not line-level fixes
- Be honest with scores — a resume that doesn't match the role should score low`,
      },
    ],
  });

  const raw = response.choices[0].message.content ?? '{}';
  // DeepSeek R1 may include reasoning before JSON — extract the JSON block
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Stage 2 audit did not return valid JSON');
  }
  const parsed = JSON.parse(jsonMatch[0]) as AuditReport;
  return parsed;
}

// ── Stage 3: Suggestion Generation (DeepSeek V3) ─────────────────────────────

async function generateTypedSuggestions(
  jdProfile: JDProfile,
  audit: AuditReport,
  resumeTex: string,
  persona: string
): Promise<Suggestion[]> {
  const deepseek = getDeepSeek();
  const lines = resumeTex.split('\n');
  const numberedResume = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');

  const systemPrompt = persona
    ? `You are a resume optimization assistant. Write in the voice described below.\n\n${persona}`
    : 'You are a resume optimization assistant. Write in a professional, impact-driven tone.';

  const response = await deepseek.chat.completions.create({
    model: 'deepseek-chat',
    temperature: 0.4,
    max_tokens: 8000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Generate resume improvement suggestions based on the JD analysis and gap audit below.

## Target Role Analysis
${JSON.stringify(jdProfile, null, 2)}

## Gap Audit Results (ATS Score: ${audit.ats_readiness_score}/100)
${JSON.stringify(audit, null, 2)}

## Resume (LaTeX source with line numbers)
${numberedResume}

---

Generate suggestions to address EVERY issue identified in the audit. Each suggestion must be one of these types:

| Type | Use when |
|------|----------|
| reframe | The audit found a framing mismatch — same content needs a different angle for this role |
| quantify | A bullet is weak/generic — add metrics or measurable impact aligned with JD priorities |
| keyword | A JD keyword is missing from an otherwise good line — insert it naturally |
| restructure | Content needs reordering — move, promote, or reorganize for this role's priorities |
| add | The audit found missing content — add a new bullet, skill, or section |
| remove | Content is irrelevant to this role and dilutes the narrative |

Respond with this JSON structure:
{
  "suggestions": [
    {
      "type": "reframe",
      "priority": "high",
      "section": "Experience",
      "line": 34,
      "old": "exact original line(s) with all LaTeX commands — character-for-character",
      "new": "improved version preserving exact LaTeX structure",
      "reason": "References the specific audit finding and names JD keywords addressed",
      "jd_keywords_addressed": ["keyword1", "keyword2"]
    }
  ]
}

## Rules for EVERY suggestion:
- "old": copy the EXACT original line verbatim — character-for-character including all LaTeX commands
- "new": CRITICAL — preserve the EXACT same LaTeX structure as the original. Only change content, never outer LaTeX commands. If old uses \\resumeItem{\\textbf{Languages}: Python, JS}, new must also use \\resumeItem{\\textbf{Languages}: ...}
- For Skills lines: never introduce LaTeX commands not already present in the original line
- "line": the 1-based line number shown at the start of the line where "old" begins
- "reason": must reference the specific audit finding this suggestion addresses AND name the JD keywords it targets
- "jd_keywords_addressed": list the specific ATS keywords from the JD profile that this suggestion adds or strengthens
- "priority": must match the audit's priority for the issue being addressed (high/medium/low)
- For "remove" type: set "new" to an empty string ""
- For "add" type where adding to an existing line: "old" is the line being modified, "new" includes the addition
- For "restructure" type: explain the reordering in "reason"

## Quality rules:
- Address ALL high-priority audit findings — do not skip any
- Each suggestion must target at least one specific JD keyword (except "remove" type)
- Do not pad with low-value suggestions
- Do not artificially cap the count — the audit findings determine the number
- A well-matched resume might need 3-5 suggestions; a poorly matched one might need 15-20`,
      },
    ],
  });

  const raw = response.choices[0].message.content ?? '{"suggestions":[]}';

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    parsed = JSON.parse(match[0]);
  }

  // Handle multiple response shapes
  let arr: unknown[] = [];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.suggestions)) {
      arr = obj.suggestions;
    } else {
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) {
          arr = v;
          break;
        }
      }
    }
  }

  // Validate and reconcile line numbers
  const validTypes = new Set(['reframe', 'quantify', 'keyword', 'restructure', 'add', 'remove']);
  const validPriorities = new Set(['high', 'medium', 'low']);
  const suggestions: Suggestion[] = [];

  for (const item of arr) {
    const s = item as Record<string, unknown>;
    if (!s.old && s.type !== 'add') continue;
    if (!s.new && s.type !== 'remove') continue;

    const oldText = String(s.old ?? '');
    const newText = String(s.new ?? '');

    // Reconcile line number
    let lineNum = 0;
    const exactIdx = lines.findIndex(l => l.includes(oldText));
    if (exactIdx >= 0) {
      lineNum = exactIdx + 1;
    } else {
      const oldFirstLine = oldText.split('\n').find(l => l.trim().length > 0) ?? oldText;
      const partialIdx = lines.findIndex(l => l.includes(oldFirstLine.trim()));
      if (partialIdx >= 0) {
        lineNum = partialIdx + 1;
      } else {
        const gptLine = typeof s.line === 'number' ? s.line : 0;
        lineNum = gptLine > 0 && gptLine <= lines.length ? gptLine : 0;
      }
    }

    if (lineNum === 0) continue;

    const type = validTypes.has(String(s.type)) ? String(s.type) as Suggestion['type'] : 'keyword';
    const priority = validPriorities.has(String(s.priority)) ? String(s.priority) as Suggestion['priority'] : 'medium';

    suggestions.push({
      type,
      priority,
      section: String(s.section ?? 'Resume'),
      line: lineNum,
      old: oldText,
      new: newText,
      reason: String(s.reason ?? ''),
      jd_keywords_addressed: Array.isArray(s.jd_keywords_addressed)
        ? (s.jd_keywords_addressed as unknown[]).map(String)
        : [],
    });
  }

  return suggestions;
}

// ── Main Pipeline ─────────────────────────────────────────────────────────────

export async function generateSuggestions(
  resumeTex: string,
  jobDescription: string,
  persona: string
): Promise<SuggestionResult> {
  console.log('[suggest] Stage 1: Analyzing job description...');
  const jdProfile = await analyzeJobDescription(jobDescription);
  console.log(`[suggest] Stage 1 complete: ${jdProfile.role_archetype} (${jdProfile.seniority}), ${jdProfile.ats_keywords.length} ATS keywords`);

  console.log('[suggest] Stage 2: Auditing resume...');
  const audit = await auditResume(jdProfile, resumeTex);
  console.log(`[suggest] Stage 2 complete: ATS readiness ${audit.ats_readiness_score}/100`);

  console.log('[suggest] Stage 3: Generating suggestions...');
  const suggestions = await generateTypedSuggestions(jdProfile, audit, resumeTex, persona);
  console.log(`[suggest] Stage 3 complete: ${suggestions.length} suggestions generated`);

  return {
    suggestions,
    atsScore: audit.ats_readiness_score,
    scoreBreakdown: audit.score_breakdown,
  };
}
