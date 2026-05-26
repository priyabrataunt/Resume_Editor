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

export type QualityMode = 'fast' | 'pro';
export type ReasoningEffort = 'medium' | 'high';
export type ProProvider = 'openai' | 'deepseek';

export const QUALITY_MODE: QualityMode =
  process.env.RESUME_QUALITY_MODE === 'pro' ? 'pro' : 'fast';

export function getProReasoningEffort(): ReasoningEffort | undefined {
  const effort = process.env.RESUME_PRO_REASONING_EFFORT;
  if (effort === 'high' || effort === 'medium') return effort;
  return undefined; // off by default — reasoning adds 60s+ latency on gpt-5.x
}

/** Pro plan+write uses OpenAI gpt-5.4 (balance of quality + ~30s latency). */
export function getProPlanWriteProvider(): ProProvider {
  return 'openai';
  // if (QUALITY_MODE !== 'pro') return 'openai';
  // return process.env.RESUME_PRO_PROVIDER === 'deepseek' ? 'deepseek' : 'openai';
}

export function getProPlanWriteModel(): string {
  if (QUALITY_MODE !== 'pro') {
    return MODELS.writing;
  }
  return process.env.RESUME_WRITING_MODEL ?? 'gpt-5.4';
  // DeepSeek pro (disabled):
  // if (getProPlanWriteProvider() === 'deepseek') {
  //   return process.env.RESUME_REASONING_MODEL ?? 'deepseek-v4-pro';
  // }
}

// ── Model identifiers (env-overridable) ──────────────────────────────────────
// Fast: gpt-5.4-mini (~5–10s). Pro: gpt-5.4 (~30–40s, no reasoning by default).
export const MODELS = {
  reasoning:
    process.env.RESUME_REASONING_MODEL ??
    (QUALITY_MODE === 'pro' ? 'gpt-5.4' : 'deepseek-v4-flash'),
  writing:
    process.env.RESUME_WRITING_MODEL ??
    (QUALITY_MODE === 'pro' ? 'gpt-5.4' : 'gpt-5.4-mini'),
  writingFallback:
    process.env.RESUME_WRITING_FALLBACK_MODEL ??
    (QUALITY_MODE === 'pro' ? 'gpt-5.4-mini' : 'gpt-4o-mini'),
  latex:
    process.env.RESUME_LATEX_MODEL ??
    (QUALITY_MODE === 'pro' ? 'gemini-3.1-pro' : 'gemini-3.5-flash'),
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

/** GPT-5 / o-series models reject `max_tokens`; they require `max_completion_tokens`. */
export function openAIUsesMaxCompletionTokens(model: string): boolean {
  return /^gpt-5|^o[134](-|$)/.test(model);
}

/** GPT-5 models only accept the default temperature (1); omit custom values. */
export function openAISupportsCustomTemperature(model: string): boolean {
  return !/^gpt-5/.test(model);
}

export interface OpenAIChatParamsInput {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: { type: 'json_object' };
  reasoningEffort?: ReasoningEffort;
}

export function buildOpenAIChatParams(input: OpenAIChatParamsInput): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  };
  if (input.temperature != null && openAISupportsCustomTemperature(input.model)) {
    params.temperature = input.temperature;
  }
  if (input.responseFormat) params.response_format = input.responseFormat;
  if (input.reasoningEffort) params.reasoning_effort = input.reasoningEffort;
  const limit = input.maxOutputTokens ?? 4000;
  if (openAIUsesMaxCompletionTokens(input.model)) {
    params.max_completion_tokens = limit;
  } else {
    params.max_tokens = limit;
  }
  return params;
}

// ── DeepSeek (OpenAI-compatible) — pro path disabled; key optional in .env ───
// let _deepseek: OpenAI | null = null;
// export function getDeepSeek(): OpenAI {
//   if (!process.env.DEEPSEEK_API_KEY) {
//     throw new Error('DEEPSEEK_API_KEY is not set. Add it to backend/.env');
//   }
//   if (!_deepseek) {
//     _deepseek = new OpenAI({
//       apiKey: process.env.DEEPSEEK_API_KEY,
//       baseURL: 'https://api.deepseek.com',
//     });
//   }
//   return _deepseek;
// }

export function isDeepSeekConfigured(): boolean {
  return false; // disabled — was: !!process.env.DEEPSEEK_API_KEY
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
  quality_mode: QualityMode;
  pro_provider: ProProvider;
  // Effective routing after key-availability fallback.
  routing: {
    planWrite: {
      provider: ProProvider;
      model: string;
      reasoning_effort?: ReasoningEffort;
    };
    writing: { provider: 'openai'; model: string };
    latex: { provider: 'gemini' | 'openai'; model: string };
  };
}

export function getProviderStatus(): ProviderStatus {
  const latexProvider = isGeminiConfigured() ? 'gemini' : 'openai';
  const proProvider = getProPlanWriteProvider();
  const planWrite: ProviderStatus['routing']['planWrite'] = {
    provider: proProvider,
    model: getProPlanWriteModel(),
  };
  if (QUALITY_MODE === 'pro') {
    const effort = getProReasoningEffort();
    if (effort) planWrite.reasoning_effort = effort;
  }
  return {
    openai: isOpenAIConfigured(),
    deepseek: isDeepSeekConfigured(),
    gemini: isGeminiConfigured(),
    models: MODELS,
    quality_mode: QUALITY_MODE,
    pro_provider: proProvider,
    routing: {
      planWrite,
      writing: { provider: 'openai', model: MODELS.writing },
      latex: {
        provider: latexProvider,
        model: latexProvider === 'gemini' ? MODELS.latex : MODELS.latexFallback,
      },
    },
  };
}
