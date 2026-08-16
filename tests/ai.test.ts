import {
  ConfiguredModelRouter,
  ModelCapabilityUnavailableError,
  OpenRouterProvider,
} from '@nox/ai';

describe('Model routing', () => {
  it('resolves configured capabilities and applies bounded text fallbacks', () => {
    const router = new ConfiguredModelRouter({
      DEFAULT: 'default-model',
      FAST: 'fast-model',
      REASONING: 'reasoning-model',
    });

    expect(router.resolve('FAST').model).toBe('fast-model');
    expect(router.resolve('CODING').model).toBe('reasoning-model');
    expect(router.resolve('MEMORY').model).toBe('fast-model');
    expect(() => router.resolve('STT')).toThrow(ModelCapabilityUnavailableError);
  });
});

describe('OpenRouterProvider', () => {
  it('uses the per-request model and normalizes usage without leaking raw provider data', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
      const request = JSON.parse(init.body) as { model: string };
      expect(request.model).toBe('configured-model');
      return new Response(
        JSON.stringify({
          model: 'resolved-model',
          choices: [{ message: { content: 'Olá!' } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4,
            total_tokens: 14,
            cost: 0.00001234,
            prompt_tokens_details: { cached_tokens: 3 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenRouterProvider({ apiKey: 'secret' });

    const response = await provider.chat({
      model: 'configured-model',
      messages: [{ role: 'user', content: 'Oi' }],
    });

    expect(response.message.content).toBe('Olá!');
    expect(response.usage).toMatchObject({
      provider: 'openrouter',
      model: 'resolved-model',
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cachedTokens: 3,
      cost: '0.00001234',
    });
    expect(response.usage?.latencyMs).toEqual(expect.any(Number));
    vi.unstubAllGlobals();
  });
});
