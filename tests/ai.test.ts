import {
  ConfiguredModelRouter,
  DefaultModelCapabilityPolicy,
  ModelCapabilityUnavailableError,
  OpenRouterProvider,
} from '@nox/ai';

describe('Backend model capability policy', () => {
  const policy = new DefaultModelCapabilityPolicy();

  it.each([
    ['Que horas são?', 'text', 'FAST'],
    ['Coloque o ar em 23 graus.', 'voice', 'FAST'],
    ['Faça uma análise complexa com múltiplas restrições.', 'text', 'REASONING'],
    ['Refatore este código TypeScript e crie testes unitários.', 'text', 'CODING'],
  ] as const)('routes %s in %s to %s', (message, interactionMode, capability) => {
    expect(policy.select({ message, interactionMode }).capability).toBe(capability);
  });

  it('does not let model names in ordinary conversation grant a higher tier', () => {
    expect(
      policy.select({ message: 'Você se chama Luna ou Sol?', interactionMode: 'text' }),
    ).toEqual({ capability: 'FAST', reason: 'simple_request' });
  });
});

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
  afterEach(() => vi.unstubAllGlobals());

  it('uses the per-request model and normalizes usage without leaking raw provider data', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
      const request = JSON.parse(init.body) as {
        model: string;
        reasoning?: { effort: string; exclude: boolean };
      };
      expect(request.model).toBe('configured-model');
      expect(request.reasoning).toEqual({ effort: 'none', exclude: true });
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
      reasoningEffort: 'none',
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
  });

  it('keeps dotted canonical tool names behind a provider-safe wire name', async () => {
    type ProviderBody = {
      tools: Array<{ function: { name: string } }>;
      messages: Array<{ tool_calls: Array<{ function: { name: string } }> }>;
    };
    const bodies: ProviderBody[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
        const body = JSON.parse(init.body) as ProviderBody;
        bodies.push(body);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'call-1',
                      function: { name: 'climate__dot__get_state', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const provider = new OpenRouterProvider({ apiKey: 'secret' });
    const response = await provider.chat({
      model: 'model',
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'old', name: 'climate.get_state', arguments: {} }],
        },
      ],
      tools: [{ name: 'climate.get_state', description: 'state', parameters: { type: 'object' } }],
    });
    const body = bodies[0];
    expect(body).toBeDefined();
    expect(body!.tools[0]!.function.name).toBe('climate__dot__get_state');
    expect(body!.messages[0]!.tool_calls[0]!.function.name).toBe('climate__dot__get_state');
    expect(response.message.toolCalls?.[0]?.name).toBe('climate.get_state');
  });

  it('preserves provider status and retryability without exposing the raw payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { message: 'messages.9.content: Invalid input' } }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );
    const provider = new OpenRouterProvider({ apiKey: 'secret' });

    await expect(
      provider.chat({ model: 'configured-model', messages: [{ role: 'user', content: 'Oi' }] }),
    ).rejects.toMatchObject({
      name: 'AIProviderError',
      provider: 'openrouter',
      status: 400,
      retryable: false,
      message: 'messages.9.content: Invalid input',
    });
  });
});
