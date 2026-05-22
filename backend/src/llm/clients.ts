// Multi-provider LLM client factories.
//
// DeepSeek exposes an OpenAI-compatible REST endpoint at api.deepseek.com,
// so we drive it through the same `openai` SDK with a different baseURL.
// Gemini ships its own SDK (@google/generative-ai). OpenAI uses its own SDK.
//
// All three are lazy-instantiated: a missing API key only errors out when
// that specific provider is actually called.

import OpenAI from 'openai';
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';

// ── Model identifiers (env-overridable) ──────────────────────────────────────
// Defaults chosen from the official docs (read May 2026):
//  - DeepSeek: deepseek-v4-pro is the reasoning flagship with `thinking` mode.
//  - OpenAI: gpt-5.5 is the current frontier writing/professional model.
//  - Gemini: gemini-3.1-pro is the advanced multimodal/code model.
//  - OpenAI Codex fallback: gpt-5.3-codex is the best agentic coding model
//    and is used when GEMINI_API_KEY is not configured.
export const MODELS = {
  reasoning: process.env.RESUME_REASONING_MODEL ?? 'deepseek-v4-pro',
  writing: process.env.RESUME_WRITING_MODEL ?? 'gpt-5.5',
  latex: process.env.RESUME_LATEX_MODEL ?? 'gemini-3.1-pro',
  latexFallback: process.env.RESUME_LATEX_FALLBACK_MODEL ?? 'gpt-5.3-codex',
};

// ── OpenAI ──────────────────────────────────────────────────────────────────
let _openai: OpenAI | null = null;
export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to backend/.env');
  }
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ── DeepSeek (OpenAI-compatible) ────────────────────────────────────────────
let _deepseek: OpenAI | null = null;
export function getDeepSeek(): OpenAI {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not set. Add it to backend/.env');
  }
  if (!_deepseek) {
    _deepseek = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    });
  }
  return _deepseek;
}

export function isDeepSeekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

// ── Gemini ──────────────────────────────────────────────────────────────────
let _gemini: GoogleGenerativeAI | null = null;
export function getGeminiClient(): GoogleGenerativeAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set. Add it to backend/.env');
  }
  if (!_gemini) _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _gemini;
}

export function getGeminiModel(modelName = MODELS.latex): GenerativeModel {
  return getGeminiClient().getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json' },
  });
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

// ── Status summary for /api/health ──────────────────────────────────────────
export interface ProviderStatus {
  openai: boolean;
  deepseek: boolean;
  gemini: boolean;
  models: typeof MODELS;
  // Effective routing after key-availability fallback.
  routing: {
    reasoning: { provider: 'deepseek' | 'openai'; model: string };
    writing: { provider: 'openai'; model: string };
    latex: { provider: 'gemini' | 'openai'; model: string };
  };
}

export function getProviderStatus(): ProviderStatus {
  const reasoningProvider = isDeepSeekConfigured() ? 'deepseek' : 'openai';
  const latexProvider = isGeminiConfigured() ? 'gemini' : 'openai';
  return {
    openai: isOpenAIConfigured(),
    deepseek: isDeepSeekConfigured(),
    gemini: isGeminiConfigured(),
    models: MODELS,
    routing: {
      reasoning: {
        provider: reasoningProvider,
        model: reasoningProvider === 'deepseek' ? MODELS.reasoning : MODELS.writing,
      },
      writing: { provider: 'openai', model: MODELS.writing },
      latex: {
        provider: latexProvider,
        model: latexProvider === 'gemini' ? MODELS.latex : MODELS.latexFallback,
      },
    },
  };
}
