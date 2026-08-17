import { EmbeddingProviderError, OpenRouterEmbeddingProvider } from '@nox/embeddings';

describe('OpenRouterEmbeddingProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates dimensions and normalizes provider usage without exposing vectors in telemetry', async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
        body = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            model: 'text-embedding-3-small',
            data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
            usage: { prompt_tokens: 4, total_tokens: 4, cost: 8e-8 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const result = await new OpenRouterEmbeddingProvider({
      apiKey: 'secret',
      dimensions: 3,
    }).embed({ model: 'openai/text-embedding-3-small', text: 'memória útil' });
    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.usage).toMatchObject({
      provider: 'openrouter',
      model: 'text-embedding-3-small',
      inputTokens: 4,
      totalTokens: 4,
      cost: '8e-8',
    });
    expect(body).toMatchObject({
      model: 'openai/text-embedding-3-small',
      input: 'memória útil',
      dimensions: 3,
      provider: { data_collection: 'deny' },
    });
  });

  it('fails closed on a wrong vector dimension and marks transient errors retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    );
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'secret', dimensions: 3 });
    await expect(provider.embed({ model: 'embedding', text: 'x' })).rejects.toBeInstanceOf(
      EmbeddingProviderError,
    );
    await expect(provider.embed({ model: 'embedding', text: 'x' })).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
  });
});
