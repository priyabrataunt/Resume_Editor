import OpenAI from 'openai';

export interface Suggestion {
  section: string;
  line: number;
  old: string;
  new: string;
  reason: string;
  ats_delta: number;
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

  const userPrompt = `Job Description:\n${jobDescription}\n\n---\n\nResume (LaTeX source with line numbers):\n${numberedResume}\n\n---\n\nSuggest targeted improvements at the bullet or line level to better match the job description. For each suggestion:\n- "old": the EXACT original text as it appears in the resume (must be a verbatim substring — copy it character-for-character including all LaTeX commands like \\resumeItem{...}, \\textbf{...}, \\texttt{...}, etc.)\n- "new": the improved replacement text. CRITICAL: preserve the EXACT same LaTeX formatting, commands, and structure as the original. If the original uses \\resumeItem{...}, the replacement must also use \\resumeItem{...}. Keep all surrounding LaTeX markup intact — only change the descriptive content inside.\n- "reason": explain how it matches JD keywords\n- "ats_delta": estimated ATS score improvement (integer, 1–20)\n- "line": the 1-based line number shown at the start of the line where "old" begins in the numbered resume above\n\nRespond with a JSON object exactly like this:\n{\n  "suggestions": [\n    {\n      "section": "Experience",\n      "line": 12,\n      "old": "\\\\resumeItem{exact original text with LaTeX commands}",\n      "new": "\\\\resumeItem{improved text preserving same LaTeX structure}",\n      "reason": "Adds metric + matches JD keyword X",\n      "ats_delta": 8\n    }\n  ]\n}\n\nLimit to the 5 highest-impact suggestions. The "suggestions" key must always be present.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.4,
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
      ats_delta: Number(s.ats_delta ?? 5),
    });
  }

  return suggestions;
}
