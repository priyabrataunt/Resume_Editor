import { afterEach, describe, expect, it, vi } from 'vitest';

describe('buildOpenAIChatParams', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('includes reasoning_effort when provided', async () => {
    const { buildOpenAIChatParams } = await import('./clients');
    const params = buildOpenAIChatParams({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'medium',
      temperature: 0.25,
    });
    expect(params.reasoning_effort).toBe('medium');
    expect(params.temperature).toBeUndefined();
    expect(params.max_completion_tokens).toBe(4000);
  });

  it('defaults pro writing to gpt-5.5 with gpt-5.4 fallback', async () => {
    vi.stubEnv('RESUME_QUALITY_MODE', 'pro');
    const { MODELS, QUALITY_MODE } = await import('./clients');
    expect(QUALITY_MODE).toBe('pro');
    expect(MODELS.writing).toBe('gpt-5.5');
    expect(MODELS.writingFallback).toBe('gpt-5.4');
  });

  it('reports OpenAI plan+write routing in pro mode', async () => {
    vi.stubEnv('RESUME_QUALITY_MODE', 'pro');
    vi.stubEnv('RESUME_PRO_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('RESUME_PRO_REASONING_EFFORT', 'high');
    const { getProviderStatus } = await import('./clients');
    const status = getProviderStatus();
    expect(status.pro_provider).toBe('openai');
    expect(status.routing.planWrite).toEqual({
      provider: 'openai',
      model: 'gpt-5.5',
      reasoning_effort: 'high',
    });
  });

  it('ignores RESUME_PRO_PROVIDER=deepseek when DeepSeek pro is disabled', async () => {
    vi.stubEnv('RESUME_QUALITY_MODE', 'pro');
    vi.stubEnv('RESUME_PRO_PROVIDER', 'deepseek');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const { getProviderStatus } = await import('./clients');
    const status = getProviderStatus();
    expect(status.pro_provider).toBe('openai');
    expect(status.routing.planWrite).toEqual({
      provider: 'openai',
      model: 'gpt-5.5',
      reasoning_effort: 'medium',
    });
    expect(status.deepseek).toBe(false);
  });

  it('fast mode uses gpt-5.4-mini without reasoning_effort in health', async () => {
    vi.stubEnv('RESUME_QUALITY_MODE', 'fast');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const { getProviderStatus, MODELS } = await import('./clients');
    expect(MODELS.writing).toBe('gpt-5.4-mini');
    const status = getProviderStatus();
    expect(status.routing.planWrite).toEqual({
      provider: 'openai',
      model: 'gpt-5.4-mini',
    });
    expect(status.routing.planWrite.reasoning_effort).toBeUndefined();
  });
});
