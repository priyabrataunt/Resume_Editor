import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import OpenAI from 'openai';
import { compileLatex } from './compile';
import { generateSuggestions } from './suggest';
import { getPersona, distillPersona } from './persona';

// Load env from local .env first
loadEnv();

// Fallback: pick up OPENAI_API_KEY from job_automation/.env so users don't
// have to duplicate the key. ../../job_automation/backend/.env relative to src/.
if (!process.env.OPENAI_API_KEY) {
  const fallback = resolve(__dirname, '../../../job_automation/backend/.env');
  if (existsSync(fallback)) {
    loadEnv({ path: fallback });
    if (process.env.OPENAI_API_KEY) {
      console.log('[resume-editor] Loaded OPENAI_API_KEY from job_automation/backend/.env');
    }
  }
}

const PORT = Number(process.env.PORT ?? 3002);

// Lazy OpenAI client — only instantiate when needed, so the server boots
// even when OPENAI_API_KEY isn't set (compile endpoint still works).
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

const fastify = Fastify({
  logger: { level: 'info' },
  bodyLimit: 5 * 1024 * 1024, // 5MB — accommodates large resumes + JDs
});

fastify.register(cors, {
  origin: true, // dev: allow any origin (Vite proxy + direct curl both work)
  methods: ['GET', 'POST'],
});

// ── /api/health ───────────────────────────────────────────────────────────────
fastify.get('/api/health', async () => ({
  ok: true,
  openai_configured: !!process.env.OPENAI_API_KEY,
}));

// ── /api/compile ──────────────────────────────────────────────────────────────
fastify.post<{ Body: { tex: string } }>('/api/compile', async (req, reply) => {
  const { tex } = req.body;
  if (!tex) {
    return reply.status(400).send({ error: 'Missing tex source' });
  }
  try {
    const pdfBuffer = await compileLatex(tex);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Length', pdfBuffer.length)
      .send(pdfBuffer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reply.status(500).send({ error: msg });
  }
});

// ── /api/suggest ──────────────────────────────────────────────────────────────
fastify.post<{ Body: { resumeTex: string; jobDescription: string } }>(
  '/api/suggest',
  async (req, reply) => {
    const { resumeTex, jobDescription } = req.body;
    if (!resumeTex || !jobDescription) {
      return reply.status(400).send({ error: 'Missing resumeTex or jobDescription' });
    }
    try {
      const openai = getOpenAI();
      const persona = await getPersona();
      const suggestions = await generateSuggestions(resumeTex, jobDescription, persona, openai);
      reply.send({ suggestions });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.status(500).send({ error: msg });
    }
  }
);

// ── /api/persona (GET) ────────────────────────────────────────────────────────
fastify.get('/api/persona', async (_req, reply) => {
  try {
    const content = await getPersona();
    reply.send({ content, active: content.length > 0 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    reply.status(500).send({ error: msg });
  }
});

// ── /api/distill-persona ──────────────────────────────────────────────────────
fastify.post<{ Body: { samplesFolder: string } }>(
  '/api/distill-persona',
  async (req, reply) => {
    const { samplesFolder } = req.body;
    if (!samplesFolder) {
      return reply.status(400).send({ error: 'Missing samplesFolder path' });
    }
    try {
      const openai = getOpenAI();
      const persona = await distillPersona(samplesFolder, openai);
      reply.send({ content: persona });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.status(500).send({ error: msg });
    }
  }
);

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`[resume-editor] Backend running on http://localhost:${PORT}`);
});
