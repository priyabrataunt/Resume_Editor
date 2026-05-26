import { afterEach, describe, expect, it, vi } from 'vitest';

describe('runPlanAndWriteStage pro routing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('calls gpt-5.5 with reasoning_effort in pro mode', async () => {
    vi.stubEnv('RESUME_QUALITY_MODE', 'pro');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('RESUME_PRO_REASONING_EFFORT', 'medium');

    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              jdSummary: 'test',
              atsScore: 70,
              projectedScore: 82,
              scoreBreakdown: {
                keyword_coverage: 70,
                experience_alignment: 60,
                skills_match: 75,
                formatting_ats_safety: 90,
              },
              drafts: [
                {
                  type: 'keyword',
                  priority: 'high',
                  section: 'Experience',
                  line: 1,
                  old: '\\item Old bullet',
                  new: '\\item New bullet',
                  intent: 'Add JD keyword',
                  reason: 'Matches role',
                  jd_keywords_addressed: ['Python'],
                },
              ],
            }),
          },
        },
      ],
    });

    const clients = await import('./clients');
    vi.spyOn(clients, 'isOpenAIConfigured').mockReturnValue(true);
    vi.spyOn(clients, 'getOpenAI').mockReturnValue({
      chat: { completions: { create: mockCreate } },
    } as unknown as ReturnType<typeof clients.getOpenAI>);

    const { runPlanAndWriteStage } = await import('./planAndWrite');
    const result = await runPlanAndWriteStage(
      '\\item Old bullet',
      'Senior Python engineer',
      '',
      12
    );

    expect(result.model).toBe('gpt-5.5');
    expect(result.drafts).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const params = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(params.model).toBe('gpt-5.5');
    expect(params.reasoning_effort).toBe('medium');
    expect(params.response_format).toEqual({ type: 'json_object' });
  });
});
