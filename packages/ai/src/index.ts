export const MODEL_CAPABILITIES = [
  'FAST',
  'DEFAULT',
  'REASONING',
  'CODING',
  'VISION',
  'MEMORY',
  'STT',
  'TTS',
] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export type ModelRoute = {
  capability: ModelCapability;
  provider: string;
  model: string;
};

export interface ModelRouter {
  resolve(capability: ModelCapability): ModelRoute;
}

export class ModelCapabilityUnavailableError extends Error {
  constructor(capability: ModelCapability) {
    super(`No model is configured for capability ${capability}`);
    this.name = 'ModelCapabilityUnavailableError';
  }
}

export class ConfiguredModelRouter implements ModelRouter {
  constructor(
    private readonly models: Partial<Record<ModelCapability, string>> & { DEFAULT: string },
    private readonly provider = 'openrouter',
  ) {}

  resolve(capability: ModelCapability): ModelRoute {
    const model = this.resolveModel(capability);
    if (!model) throw new ModelCapabilityUnavailableError(capability);
    return { capability, provider: this.provider, model };
  }

  private resolveModel(capability: ModelCapability): string | undefined {
    if (this.models[capability]) return this.models[capability];
    switch (capability) {
      case 'FAST':
      case 'REASONING':
        return this.models.DEFAULT;
      case 'CODING':
        return this.models.REASONING ?? this.models.DEFAULT;
      case 'MEMORY':
        return this.models.FAST ?? this.models.DEFAULT;
      case 'DEFAULT':
        return this.models.DEFAULT;
      case 'VISION':
      case 'STT':
      case 'TTS':
        return undefined;
    }
  }
}

export type MessageContent =
  string | Array<{ type: 'text'; text: string } | { type: 'image_url'; imageUrl: string }>;
export type ToolCall = { id: string; name: string; arguments: unknown };
export type AIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  toolCallId?: string;
  toolCalls?: ToolCall[];
};
export type AITool = { name: string; description: string; parameters: Record<string, unknown> };
export type ChatRequest = {
  model: string;
  messages: AIMessage[];
  tools?: AITool[];
  signal?: AbortSignal;
};
export type AIUsage = {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  latencyMs: number;
  cost?: string;
};
export type ChatResponse = {
  message: AIMessage;
  usage?: AIUsage;
};
export interface AIProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<string>;
}

export class AIProviderError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly provider: string,
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'AIProviderError';
    this.retryable =
      status === undefined ||
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      status >= 500;
  }
}

export function isInvalidProviderMessageError(error: unknown): error is AIProviderError {
  return (
    error instanceof AIProviderError &&
    error.status === 400 &&
    /messages\.\d+\.content:\s*Invalid input/i.test(error.message)
  );
}

type Options = {
  apiKey: string;
  baseUrl?: string;
  siteUrl?: string;
  appName?: string;
  timeoutMs?: number;
};
type Payload = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number | string;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
};

export class OpenRouterProvider implements AIProvider {
  constructor(private readonly options: Options) {}
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const started = performance.now();
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.options.siteUrl) headers['HTTP-Referer'] = this.options.siteUrl;
    if (this.options.appName) headers['X-Title'] = this.options.appName;
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`,
      {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map(toProviderMessage),
          tools: request.tools?.map((tool) => ({ type: 'function', function: tool })),
          tool_choice: request.tools?.length ? 'auto' : undefined,
        }),
      },
    );
    const payload = await readPayload(response);
    if (!response.ok)
      throw new AIProviderError(
        'openrouter',
        response.status,
        payload.error?.message ?? `OpenRouter error ${response.status}`,
      );
    const value = payload.choices?.[0]?.message;
    if (!value) throw new Error('OpenRouter returned no message');
    const message: AIMessage = { role: 'assistant', content: value.content ?? '' };
    if (value.tool_calls)
      message.toolCalls = value.tool_calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      }));
    const usage: AIUsage = {
      provider: 'openrouter',
      model: payload.model ?? request.model,
      latencyMs: Math.round(performance.now() - started),
    };
    if (payload.usage?.prompt_tokens !== undefined) usage.inputTokens = payload.usage.prompt_tokens;
    if (payload.usage?.completion_tokens !== undefined)
      usage.outputTokens = payload.usage.completion_tokens;
    if (payload.usage?.total_tokens !== undefined) usage.totalTokens = payload.usage.total_tokens;
    if (payload.usage?.prompt_tokens_details?.cached_tokens !== undefined)
      usage.cachedTokens = payload.usage.prompt_tokens_details.cached_tokens;
    const cost = decimalString(payload.usage?.cost);
    if (cost !== undefined) usage.cost = cost;
    return { message, usage };
  }
  async *stream(request: ChatRequest): AsyncIterable<string> {
    const response = await this.chat(request);
    if (typeof response.message.content === 'string') yield response.message.content;
  }
}

async function readPayload(response: Response): Promise<Payload> {
  try {
    return (await response.json()) as Payload;
  } catch {
    if (!response.ok)
      throw new AIProviderError(
        'openrouter',
        response.status,
        `OpenRouter error ${response.status}`,
      );
    throw new AIProviderError('openrouter', response.status, 'OpenRouter returned invalid JSON');
  }
}

function toProviderMessage(message: AIMessage): Record<string, unknown> {
  const result: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.toolCallId) result.tool_call_id = message.toolCallId;
  if (message.toolCalls?.length)
    result.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }));
  return result;
}
function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Provider returned invalid tool arguments');
  }
}
function decimalString(value: number | string | undefined): string | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? String(value) : undefined;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) return value;
  return undefined;
}
