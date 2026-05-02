import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
  stat,
} from 'fs/promises';
import { join } from 'path';
import OpenAI from 'openai';

export const PROFILES_DIR = join(__dirname, '../profiles');

export interface ProfileMeta {
  name: string;
  roleType: string;
  description: string;
  updatedAt: string;
}

export interface ProfileListItem {
  slug: string;
  name: string;
  roleType: string;
  description: string;
  updatedAt: string;
}

export interface ProfilePayload {
  name: string;
  roleType: string;
  tex: string;
  description: string;
}

const RESUME_FILE = 'resume.tex';
const META_FILE = 'meta.json';

export function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'profile';
}

export function assertSafeSlug(slug: string): void {
  if (!slug || slug.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Invalid profile slug');
  }
}

async function profileDir(slug: string): Promise<string> {
  assertSafeSlug(slug);
  return join(PROFILES_DIR, slug);
}

export async function listProfiles(): Promise<ProfileListItem[]> {
  let names: string[];
  try {
    names = await readdir(PROFILES_DIR);
  } catch {
    return [];
  }

  const out: ProfileListItem[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const dir = join(PROFILES_DIR, name);
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      const raw = await readFile(join(dir, META_FILE), 'utf-8');
      const meta = JSON.parse(raw) as Partial<ProfileMeta>;
      out.push({
        slug: name,
        name: String(meta.name ?? name),
        roleType: String(meta.roleType ?? ''),
        description: String(meta.description ?? ''),
        updatedAt: String(meta.updatedAt ?? ''),
      });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug));
  return out;
}

export async function getProfile(slug: string): Promise<ProfilePayload & { slug: string }> {
  const dir = await profileDir(slug);
  const raw = await readFile(join(dir, META_FILE), 'utf-8').catch(() => {
    throw new Error('Profile not found');
  });
  const meta = JSON.parse(raw) as Partial<ProfileMeta>;
  const tex = await readFile(join(dir, RESUME_FILE), 'utf-8').catch(() => '');
  return {
    slug,
    name: String(meta.name ?? slug),
    roleType: String(meta.roleType ?? ''),
    description: String(meta.description ?? ''),
    tex,
  };
}

export async function saveProfile(
  slug: string,
  body: ProfilePayload
): Promise<ProfileListItem> {
  assertSafeSlug(slug);
  const dir = join(PROFILES_DIR, slug);
  await mkdir(dir, { recursive: true });
  const updatedAt = new Date().toISOString();
  const meta: ProfileMeta = {
    name: body.name.trim() || slug,
    roleType: body.roleType.trim(),
    description: body.description.trim(),
    updatedAt,
  };
  await writeFile(join(dir, META_FILE), JSON.stringify(meta, null, 2), 'utf-8');
  await writeFile(join(dir, RESUME_FILE), body.tex ?? '', 'utf-8');
  return {
    slug,
    name: meta.name,
    roleType: meta.roleType,
    description: meta.description,
    updatedAt,
  };
}

export async function deleteProfile(slug: string): Promise<void> {
  const dir = await profileDir(slug);
  await rm(dir, { recursive: true, force: true });
}

export interface AutoDetectResult {
  slug: string | null;
  confidence: number;
  reasoning: string;
}

export async function autoDetectProfile(
  jobDescription: string,
  openai: OpenAI
): Promise<AutoDetectResult> {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    return {
      slug: null,
      confidence: 0,
      reasoning: 'No saved profiles yet. Create a profile with "+ New" and Save.',
    };
  }

  const catalog = profiles
    .map(
      p =>
        `- slug: ${p.slug}\n  name: ${p.name}\n  roleType: ${p.roleType}\n  description: ${p.description || '(none)'}`
    )
    .join('\n');

  const user = `Job description:\n---\n${jobDescription.slice(0, 24_000)}\n---\n\nSaved resume profiles:\n${catalog}\n\nPick the single best-matching profile slug for this job. Respond with ONLY JSON:\n{"slug":"<slug or null>","confidence":0-100,"reasoning":"<one short sentence>"}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You match job descriptions to resume profile metadata. Choose exactly one slug from the list, or null if none fit. Be conservative: prefer null over a weak match.',
      },
      { role: 'user', content: user },
    ],
  });

  const raw = response.choices[0].message.content ?? '{}';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { slug: null, confidence: 0, reasoning: 'Could not parse model response.' };
  }

  const slugRaw = parsed.slug;
  const slug =
    typeof slugRaw === 'string' && profiles.some(p => p.slug === slugRaw) ? slugRaw : null;
  const confidence =
    typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
      : 0;
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

  return { slug, confidence, reasoning };
}
