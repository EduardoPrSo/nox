export type EmbeddingUsage = {
  provider: string;
  model: string;
  inputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  cost?: string;
};

export type EmbeddingResult = {
  embedding: number[];
  usage: EmbeddingUsage;
};

export interface EmbeddingProvider {
  embed(input: { model: string; text: string; signal?: AbortSignal }): Promise<EmbeddingResult>;
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions = 1536) {}

  async embed(input: { model: string; text: string }): Promise<EmbeddingResult> {
    const embedding = Array.from({ length: this.dimensions }, () => 0);
    for (let index = 0; index < input.text.length; index++) {
      const slot = (input.text.codePointAt(index) ?? 0) % this.dimensions;
      embedding[slot] = (embedding[slot] ?? 0) + 1;
    }
    const magnitude = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0)) || 1;
    return {
      embedding: embedding.map((value) => value / magnitude),
      usage: { provider: 'deterministic-local', model: input.model, latencyMs: 0 },
    };
  }
}

type OpenRouterEmbeddingOptions = {
  apiKey: string;
  baseUrl?: string;
  siteUrl?: string;
  appName?: string;
  timeoutMs?: number;
  dimensions?: number;
};

type EmbeddingPayload = {
  model?: string;
  data?: Array<{ embedding?: number[]; index?: number }>;
  usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number | string };
  error?: { message?: string };
};

export class EmbeddingProviderError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly provider: string,
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'EmbeddingProviderError';
    this.retryable = status === undefined || status === 408 || status === 429 || status >= 500;
  }
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly options: OpenRouterEmbeddingOptions) {}

  async embed(input: {
    model: string;
    text: string;
    signal?: AbortSignal;
  }): Promise<EmbeddingResult> {
    const started = performance.now();
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 20_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.options.siteUrl) headers['HTTP-Referer'] = this.options.siteUrl;
    if (this.options.appName) headers['X-Title'] = this.options.appName;
    let response: Response;
    try {
      response = await fetch(
        `${this.options.baseUrl ?? 'https://openrouter.ai/api/v1'}/embeddings`,
        {
          method: 'POST',
          headers,
          signal,
          body: JSON.stringify({
            model: input.model,
            input: input.text,
            encoding_format: 'float',
            ...(this.options.dimensions ? { dimensions: this.options.dimensions } : {}),
            provider: { data_collection: 'deny' },
          }),
        },
      );
    } catch (error) {
      throw new EmbeddingProviderError(
        'openrouter',
        undefined,
        error instanceof Error ? error.message : 'OpenRouter embedding request failed',
      );
    }
    const payload = await readEmbeddingPayload(response);
    if (!response.ok)
      throw new EmbeddingProviderError(
        'openrouter',
        response.status,
        payload.error?.message ?? `OpenRouter embedding error ${response.status}`,
      );
    const embedding =
      payload.data?.find((item) => item.index === 0)?.embedding ?? payload.data?.[0]?.embedding;
    if (!embedding?.length || embedding.some((value) => !Number.isFinite(value)))
      throw new EmbeddingProviderError(
        'openrouter',
        response.status,
        'OpenRouter returned an invalid embedding',
      );
    if (this.options.dimensions && embedding.length !== this.options.dimensions)
      throw new EmbeddingProviderError(
        'openrouter',
        response.status,
        `Expected ${this.options.dimensions} embedding dimensions, received ${embedding.length}`,
      );
    const usage: EmbeddingUsage = {
      provider: 'openrouter',
      model: payload.model ?? input.model,
      latencyMs: Math.round(performance.now() - started),
    };
    if (payload.usage?.prompt_tokens !== undefined) usage.inputTokens = payload.usage.prompt_tokens;
    if (payload.usage?.total_tokens !== undefined) usage.totalTokens = payload.usage.total_tokens;
    const cost = decimalString(payload.usage?.cost);
    if (cost !== undefined) usage.cost = cost;
    return { embedding, usage };
  }
}

async function readEmbeddingPayload(response: Response): Promise<EmbeddingPayload> {
  try {
    return (await response.json()) as EmbeddingPayload;
  } catch {
    throw new EmbeddingProviderError(
      'openrouter',
      response.status,
      `OpenRouter embedding endpoint returned invalid JSON (${response.status})`,
    );
  }
}

function decimalString(value: number | string | undefined): string | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? String(value) : undefined;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(value)) return value;
  return undefined;
}
