import { readFile, writeFile, readdir } from 'fs/promises';
import { join, extname } from 'path';
import OpenAI from 'openai';

const PERSONA_PATH = join(__dirname, '..', 'persona.md');

// Priyabrata_persona folder sits at repo root (one level above backend/)
const PRIYABRATA_PERSONA_DIR = join(__dirname, '..', '..', 'Priyabrata_persona');

export async function getPersona(): Promise<string> {
  // 1. Prefer an explicitly distilled persona.md (user-customized or AI-distilled)
  try {
    const md = await readFile(PERSONA_PATH, 'utf-8');
    if (md.trim().length > 50) return md;
  } catch {}

  // 2. Auto-build from Priyabrata_persona folder (no API call needed)
  try {
    const persona = await buildPersonaFromFolder(PRIYABRATA_PERSONA_DIR);
    if (persona) return persona;
  } catch {}

  return '';
}

async function buildPersonaFromFolder(folder: string): Promise<string> {
  const parts: string[] = [];

  // Core resume writing rules derived from Priyabrata's writing style
  parts.push(
    `You are rewriting resume bullet points in the authentic voice of Priyabrata Behera.
Study the writing samples below to understand how he writes, then apply that voice to resume improvements.

## His Writing Style (derived from samples)
- **Direct and specific**: Names exact technologies, tools, metrics — never vague
- **Action-first**: Every sentence starts with what he did, not what the project was about
- **Outcome-focused**: Describes what changed or improved because of the work
- **No corporate fluff**: Uses plain, precise words — not "leveraged synergies" but "built", "cut", "automated"
- **Concise**: One clear idea per sentence, no run-ons
- **Technical honesty**: Names the actual thing (AWS Lambda, GPT-4o, Microsoft Graph API) not generic terms

## Resume Bullet Rules (always follow these)
1. Start with a strong past-tense action verb: Built, Engineered, Automated, Designed, Reduced, Implemented, Eliminated, Integrated, Deployed, Optimized
2. Be specific: include exact tech stack, numbers, scale (e.g. "3 planning commands", "across 500+ users", "cut from 4 steps to 1")
3. Show the outcome: what became faster, safer, smaller, or more reliable?
4. Keep it to 1–2 lines max — resume bullets are not paragraphs
5. Never use: leveraged, utilized, spearheaded, synergized, facilitated, ensured, collaborated to achieve
6. Preserve ALL LaTeX formatting exactly — if original has \\resumeItem{...}, replacement must too`
  );

  // Load writing samples from JSON
  try {
    const writingPath = join(folder, 'Priyabrata_Writing.json');
    const raw = await readFile(writingPath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;

    // Professional emails: best signal for formal-but-direct voice
    const emails = (data.email_messages as string[] ?? [])
      .filter(e => e.trim().length > 40)
      .slice(0, 4)
      .map((e, i) => `  [${i + 1}] ${e.trim().replace(/\n+/g, ' ').slice(0, 350)}`);

    if (emails.length > 0) {
      parts.push(
        `\n## Priyabrata's Professional Writing (emails) — mirror this directness in resume bullets\n${emails.join('\n\n')}`
      );
    }

    // Approach messages: concise, professional, no padding
    const approach = (data.approach_messages as string[] ?? [])
      .filter(a => a.trim().length > 20)
      .slice(0, 3)
      .map((a, i) => `  [${i + 1}] ${a.trim().replace(/\n+/g, ' ')}`);

    if (approach.length > 0) {
      parts.push(
        `\n## Priyabrata's Professional Outreach — notice the conciseness and directness\n${approach.join('\n\n')}`
      );
    }
  } catch {
    // JSON unavailable — still use the rules above
  }

  // Load instruction file if it has useful content
  try {
    const instrPath = join(folder, 'Instuction.txt');
    const instr = await readFile(instrPath, 'utf-8');
    if (instr.trim().length > 20) {
      parts.push(`\n## Additional Instructions from Priyabrata\n${instr.trim()}`);
    }
  } catch {}

  if (parts.length === 0) return '';

  return parts.join('\n\n');
}

export async function distillPersona(
  samplesFolder: string,
  openai: OpenAI
): Promise<string> {
  const files = await readdir(samplesFolder);
  const supportedExts = new Set(['.txt', '.md', '.json', '.html', '.htm']);

  const chunks: string[] = [];
  let totalChars = 0;
  const MAX_CHARS = 60_000; // keep well under context limit

  for (const file of files) {
    if (totalChars >= MAX_CHARS) break;
    if (!supportedExts.has(extname(file).toLowerCase())) continue;

    const content = await readFile(join(samplesFolder, file), 'utf-8');
    const snippet = content.slice(0, 8_000);
    chunks.push(`--- ${file} ---\n${snippet}`);
    totalChars += snippet.length;
  }

  if (chunks.length === 0) {
    throw new Error('No readable writing samples found in the specified folder');
  }

  const corpus = chunks.join('\n\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content:
          'You are a writing style analyst. Extract a concise, actionable style guide from the provided writing samples. Focus only on patterns you observe with high confidence.',
      },
      {
        role: 'user',
        content: `Here are writing samples from one person:\n\n${corpus}\n\nExtract this person's writing style into a concise style guide (400–600 words) covering:\n1. Sentence structure and length preferences\n2. Vocabulary and word choice patterns\n3. Preferred action verbs\n4. Tone (formal/casual, direct/diplomatic)\n5. How they frame accomplishments and impact\n6. Things they consistently avoid\n\nFormat as clear bullet points under each heading. This will be used as a system prompt to write in their voice.`,
      },
    ],
  });

  const persona = response.choices[0].message.content ?? '';
  await writeFile(PERSONA_PATH, persona, 'utf-8');
  return persona;
}
