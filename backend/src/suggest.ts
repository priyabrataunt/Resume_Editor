import OpenAI from 'openai';

export interface Suggestion {
  section: string;
  line: number;
  old: string;
  new: string;
  reason: string;
}


export async function generateSuggestions(
  resumeTex: string,
  jobDescription: string,
  persona: string,
  openai: OpenAI
): Promise<Suggestion[]> {
  const lines = resumeTex.split('\n');

  // Build numbered resume text so GPT sees exact line numbers
  const numberedResume = lines
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n');

  const systemPrompt = persona
    ? `You are a resume optimization assistant. Write in the voice described below.\n\n${persona}`
    : 'You are a resume optimization assistant. Write in a professional, impact-driven tone.';

  const userPrompt = `Job Description:\n${jobDescription}\n\n---\n\nResume (LaTeX source with line numbers):\n${numberedResume}\n\n---\n\nYour goal: maximize this resume's ATS score for the specific job description above.

STEP 1 — Analyze the JD:
Extract every keyword, technology, tool, methodology, skill, and requirement mentioned in the JD. Note how many times each appears (frequency = importance).

STEP 2 — Audit every resume line:
Go through every bullet point, skill line, and summary line in the resume. For each one, ask: "Could this line better match the JD?" Flag any line where:
- A JD keyword is absent but could naturally fit the candidate's described work
- The phrasing is weak/generic when the JD uses specific terminology
- A measurable impact could be added that aligns with JD priorities
- A skill is missing from the Skills section that appears in the JD and fits the candidate's background

STEP 3 — Generate a suggestion for EVERY flagged line. There is no minimum or maximum — generate as many as genuinely improve ATS alignment. A strong resume might need 5 suggestions; a weak match might need 20. Let the actual JD-resume gap determine the count.

Rules for every suggestion:
- "old": copy the EXACT original line verbatim — character-for-character including all LaTeX commands
- "new": the improved replacement. CRITICAL: preserve the EXACT same LaTeX structure as the original. Only change content, never outer LaTeX commands. If old uses \\resumeItem{\\textbf{Languages}: Python, JS}, new must also use \\resumeItem{\\textbf{Languages}: Python, JS, TypeScript}.
- For Skills lines: the section may use any LaTeX format. Never introduce \\resumeItem or any command not already present in the line you are modifying.
- "section": the resume section this line belongs to (e.g. "Experience", "Projects", "Skills", "Summary", "Education")
- "reason": name the specific JD keywords added and their frequency in the JD
- "line": the 1-based line number shown at the start of the line where "old" begins

Respond with this JSON structure:
{
  "suggestions": [
    {
      "section": "Experience",
      "line": 12,
      "old": "exact original line with all LaTeX commands",
      "new": "improved line preserving exact LaTeX structure",
      "reason": "Adds 'Kubernetes' (appears 5x in JD) and quantifies impact"
    }
  ]
}

The "suggestions" key must always be present. Do not pad with low-value suggestions, but do not artificially cap the count — cover every line where there is a genuine ATS improvement opportunity.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.4,
    max_tokens: 8000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = response.choices[0].message.content ?? '{"suggestions":[]}';

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Regex fallback: extract JSON array from response
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    parsed = JSON.parse(match[0]);
  }

  // Handle multiple shapes:
  // 1. Direct array: [...]
  // 2. { suggestions: [...] }
  // 3. { <any-key>: [...] } — find first array value in the object
  let arr: unknown[] = [];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.suggestions)) {
      arr = obj.suggestions;
    } else {
      // Find first array value (model may use a different key)
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) {
          arr = v;
          break;
        }
      }
    }
  }

  // Validate and coerce each suggestion
  const suggestions: Suggestion[] = [];
  for (const item of arr) {
    const s = item as Record<string, unknown>;
    if (!s.old || !s.new) continue;

    const oldText = String(s.old);
    const newText = String(s.new);

    // Always verify line number by searching for old text in the actual resume.
    // GPT's line numbers are often wrong, so we find the real line.
    let lineNum = 0;

    // First: try exact single-line match
    const exactIdx = lines.findIndex(l => l.includes(oldText));
    if (exactIdx >= 0) {
      lineNum = exactIdx + 1;
    } else {
      // Multi-line old text: find the starting line by matching the first
      // non-empty line of old text within the full resume
      const oldFirstLine = oldText.split('\n').find(l => l.trim().length > 0) ?? oldText;
      const partialIdx = lines.findIndex(l => l.includes(oldFirstLine.trim()));
      if (partialIdx >= 0) {
        lineNum = partialIdx + 1;
      } else {
        // Last resort: use GPT's line number if it seems plausible
        const gptLine = typeof s.line === 'number' ? s.line : 0;
        lineNum = gptLine > 0 && gptLine <= lines.length ? gptLine : 0;
      }
    }

    // Skip suggestions where we can't determine a valid line
    if (lineNum === 0) continue;

    suggestions.push({
      section: String(s.section ?? 'Resume'),
      line: lineNum,
      old: oldText,
      new: newText,
      reason: String(s.reason ?? ''),
    });
  }

  return suggestions;
}
