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
export type ChatRequest = { messages: AIMessage[]; tools?: AITool[]; signal?: AbortSignal };
export type ChatResponse = {
  message: AIMessage;
  usage?: { inputTokens?: number; outputTokens?: number };
};
export interface AIProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<string>;
  transcribe?(audio: Uint8Array, mimeType: string): Promise<string>;
  speak?(text: string): Promise<Uint8Array>;
}

type Options = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  siteUrl?: string;
  appName?: string;
  timeoutMs?: number;
};
type Payload = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export class OpenRouterProvider implements AIProvider {
  constructor(private readonly options: Options) {}
  async chat(request: ChatRequest): Promise<ChatResponse> {
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
          model: this.options.model,
          messages: request.messages.map(toProviderMessage),
          tools: request.tools?.map((tool) => ({ type: 'function', function: tool })),
          tool_choice: request.tools?.length ? 'auto' : undefined,
        }),
      },
    );
    const payload = (await response.json()) as Payload;
    if (!response.ok)
      throw new Error(payload.error?.message ?? `OpenRouter error ${response.status}`);
    const value = payload.choices?.[0]?.message;
    if (!value) throw new Error('OpenRouter returned no message');
    const message: AIMessage = { role: 'assistant', content: value.content ?? '' };
    if (value.tool_calls)
      message.toolCalls = value.tool_calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      }));
    const result: ChatResponse = { message };
    if (payload.usage) {
      result.usage = {};
      if (payload.usage.prompt_tokens !== undefined)
        result.usage.inputTokens = payload.usage.prompt_tokens;
      if (payload.usage.completion_tokens !== undefined)
        result.usage.outputTokens = payload.usage.completion_tokens;
    }
    return result;
  }
  async *stream(request: ChatRequest): AsyncIterable<string> {
    const response = await this.chat(request);
    if (typeof response.message.content === 'string') yield response.message.content;
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
