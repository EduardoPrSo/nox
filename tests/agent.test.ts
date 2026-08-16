import {
  AIProviderError,
  ConfiguredModelRouter,
  type AIProvider,
  type ChatRequest,
  type ChatResponse,
} from '@nox/ai';
import { AgentRuntime } from '@nox/agent';
import { InMemoryAuditRepository, sanitize } from '@nox/audit';
import { InMemoryConfirmationRepository } from '@nox/confirmations';
import { InMemoryMemoryStore } from '@nox/memory';
import { DefaultPermissionEngine } from '@nox/permissions';
import { ToolRegistry, createMockTools } from '@nox/tools';
import { InMemoryAIUsageRepository, type AIUsageRepository } from '@nox/usage';

class QueueProvider implements AIProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly responses: ChatResponse[]) {}
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('No queued response');
    return response;
  }
  async *stream(): AsyncIterable<string> {
    yield '';
  }
}

class RejectHistoricalToolProvider implements AIProvider {
  readonly requests: ChatRequest[] = [];

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    if (request.messages.some((message) => message.role === 'tool'))
      throw new AIProviderError('openrouter', 400, 'messages.3.content: Invalid input');
    return { message: { role: 'assistant', content: 'Conversa recuperada.' } };
  }

  async *stream(): AsyncIterable<string> {
    yield '';
  }
}
const identity = (userId = 'u1') => ({
  userId,
  deviceId: 'test-device',
  sessionId: '11111111-1111-4111-8111-111111111111',
});

function runtime(
  provider: AIProvider,
  allowActionTools = false,
  options: {
    memory?: InMemoryMemoryStore;
    usage?: AIUsageRepository;
    contextMessageLimit?: number;
    onTelemetryError?: (error: unknown) => void;
  } = {},
) {
  const tools = new ToolRegistry();
  for (const tool of createMockTools(() => new Date('2026-08-15T12:00:00Z'))) tools.register(tool);
  const audit = new InMemoryAuditRepository();
  const usage = options.usage ?? new InMemoryAIUsageRepository();
  return {
    audit,
    usage,
    runtime: new AgentRuntime({
      provider,
      router: new ConfiguredModelRouter({ DEFAULT: 'default-model', FAST: 'fast-model' }),
      usage,
      tools,
      audit,
      memory: options.memory ?? new InMemoryMemoryStore(),
      confirmations: new InMemoryConfirmationRepository(),
      permissions: new DefaultPermissionEngine({ allowActionTools }),
      ...(options.contextMessageLimit !== undefined
        ? { contextMessageLimit: options.contextMessageLimit }
        : {}),
      ...(options.onTelemetryError ? { onTelemetryError: options.onTelemetryError } : {}),
    }),
  };
}

describe('AgentRuntime', () => {
  it('executes a READ tool without confirmation and returns the final answer', async () => {
    const provider = new QueueProvider([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-1', name: 'get_current_time', arguments: { timezone: 'UTC' } }],
        },
      },
      { message: { role: 'assistant', content: 'São 12:00 UTC.' } },
    ]);
    const subject = runtime(provider);
    await expect(
      subject.runtime.run({ ...identity(), message: 'Que horas são?' }),
    ).resolves.toMatchObject({ type: 'message', content: 'São 12:00 UTC.' });
    expect(provider.requests[0]?.messages[0]?.role).toBe('system');
    expect(provider.requests[0]?.messages[0]?.content).toContain('You are NOX');
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      'Respond in Brazilian Portuguese by default',
    );
    expect(provider.requests[0]?.model).toBe('default-model');
    expect(subject.audit.events.some((event) => event.type === 'tool_result')).toBe(true);
  });

  it('binds EXTERNAL approval to one validated call and executes only after approval', async () => {
    const provider = new QueueProvider([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call-2',
              name: 'send_message_mock',
              arguments: { recipient: 'João', message: 'Estou chegando.' },
            },
          ],
        },
      },
      { message: { role: 'assistant', content: 'Mensagem enviada.' } },
    ]);
    const subject = runtime(provider);
    const pending = await subject.runtime.run({
      ...identity(),
      message: 'Mande mensagem para João',
    });
    expect(pending).toMatchObject({
      type: 'confirmation_required',
      description: 'Enviar para João: “Estou chegando.”',
    });
    if (pending.type !== 'confirmation_required') throw new Error('Expected confirmation');
    const approved = await subject.runtime.confirm({
      ...identity(),
      confirmationId: pending.confirmationId,
      approve: true,
    });
    expect(approved).toMatchObject({
      type: 'message',
      content: 'Mensagem enviada.',
      conversationId: pending.conversationId,
    });
    await expect(
      subject.runtime.confirm({
        ...identity(),
        confirmationId: pending.confirmationId,
        approve: true,
      }),
    ).resolves.toMatchObject({ type: 'error', code: 'NOT_FOUND' });
  });

  it('does not let another user approve a pending call', async () => {
    const provider = new QueueProvider([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c', name: 'climate_set_temperature', arguments: { temperature: 23 } }],
        },
      },
    ]);
    const subject = runtime(provider);
    const pending = await subject.runtime.run({
      ...identity('owner'),
      message: 'Coloque em 23',
    });
    if (pending.type !== 'confirmation_required') throw new Error('Expected confirmation');
    await expect(
      subject.runtime.confirm({
        ...identity('attacker'),
        confirmationId: pending.confirmationId,
        approve: true,
      }),
    ).resolves.toMatchObject({ type: 'error', code: 'NOT_FOUND' });
  });

  it('rejects invalid tool arguments before execution', async () => {
    const provider = new QueueProvider([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'bad', name: 'climate_set_temperature', arguments: { temperature: 99 } },
          ],
        },
      },
      { message: { role: 'assistant', content: 'Temperatura inválida.' } },
    ]);
    await expect(
      runtime(provider, true).runtime.run({ ...identity(), message: 'Coloque em 99' }),
    ).resolves.toMatchObject({ type: 'message', content: 'Temperatura inválida.' });
  });
  it('keeps conversation history when the runtime is recreated and limits context', async () => {
    const memory = new InMemoryMemoryStore();
    const firstProvider = new QueueProvider([
      { message: { role: 'assistant', content: 'Primeira resposta.' } },
    ]);
    const first = runtime(firstProvider, false, { memory });
    const firstResponse = await first.runtime.run({ ...identity(), message: 'Primeira pergunta' });
    if (firstResponse.type !== 'message') throw new Error('Expected message');

    const secondProvider = new QueueProvider([
      { message: { role: 'assistant', content: 'Segunda resposta.' } },
    ]);
    const second = runtime(secondProvider, false, { memory, contextMessageLimit: 2 });
    await second.runtime.run({
      ...identity(),
      conversationId: firstResponse.conversationId,
      message: 'Segunda pergunta',
    });

    expect(secondProvider.requests[0]?.messages.slice(1)).toEqual([
      { role: 'user', content: 'Primeira pergunta' },
      { role: 'assistant', content: 'Primeira resposta.' },
      { role: 'user', content: 'Segunda pergunta' },
    ]);
  });

  it('recovers from rejected persisted tool protocol without losing the conversation', async () => {
    const memory = new InMemoryMemoryStore();
    const firstProvider = new QueueProvider([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-history', name: 'climate_get_status', arguments: {} }],
        },
      },
      { message: { role: 'assistant', content: 'O ar está em 24 graus.' } },
    ]);
    const first = runtime(firstProvider, false, { memory });
    const firstResponse = await first.runtime.run({ ...identity(), message: 'Como está o ar?' });
    if (firstResponse.type !== 'message') throw new Error('Expected message');

    const recoveringProvider = new RejectHistoricalToolProvider();
    const second = runtime(recoveringProvider, false, { memory });
    await expect(
      second.runtime.run({
        ...identity(),
        conversationId: firstResponse.conversationId,
        message: 'Continue.',
      }),
    ).resolves.toMatchObject({ type: 'message', content: 'Conversa recuperada.' });

    expect(recoveringProvider.requests).toHaveLength(2);
    expect(
      recoveringProvider.requests[0]?.messages.some((message) => message.role === 'tool'),
    ).toBe(true);
    expect(recoveringProvider.requests[1]?.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'Como está o ar?' },
      { role: 'assistant', content: 'O ar está em 24 graus.' },
      { role: 'user', content: 'Continue.' },
    ]);
  });

  it('does not fail a valid response when usage persistence fails', async () => {
    const telemetryErrors: unknown[] = [];
    const failingUsage: AIUsageRepository = {
      async record() {
        throw new Error('usage unavailable');
      },
    };
    const provider = new QueueProvider([
      {
        message: { role: 'assistant', content: 'Resposta preservada.' },
        usage: {
          provider: 'openrouter',
          model: 'resolved-model',
          inputTokens: 10,
          outputTokens: 3,
          totalTokens: 13,
          latencyMs: 25,
          cost: '0.000012',
        },
      },
    ]);
    const subject = runtime(provider, false, {
      usage: failingUsage,
      onTelemetryError: (error) => telemetryErrors.push(error),
    });

    await expect(subject.runtime.run({ ...identity(), message: 'Oi' })).resolves.toMatchObject({
      type: 'message',
      content: 'Resposta preservada.',
    });
    expect(telemetryErrors).toHaveLength(1);
  });

  it('records normalized usage with identity, conversation and capability', async () => {
    const usage = new InMemoryAIUsageRepository();
    const provider = new QueueProvider([
      {
        message: { role: 'assistant', content: 'Feito.' },
        usage: {
          provider: 'openrouter',
          model: 'resolved-model',
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
          cachedTokens: 4,
          latencyMs: 18,
          cost: '0.000010',
        },
      },
    ]);
    const subject = runtime(provider, false, { usage });
    const response = await subject.runtime.run({ ...identity(), message: 'Registre' });
    if (response.type !== 'message') throw new Error('Expected message');

    expect(usage.records).toHaveLength(1);
    expect(usage.records[0]).toMatchObject({
      userId: 'u1',
      deviceId: 'test-device',
      sessionId: identity().sessionId,
      conversationId: response.conversationId,
      provider: 'openrouter',
      model: 'resolved-model',
      capability: 'DEFAULT',
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
      cachedTokens: 4,
      latencyMs: 18,
      estimatedCost: '0.000010',
    });
  });
});

it('redacts sensitive fields recursively', () => {
  expect(sanitize({ nested: { apiKey: 'secret', safe: 'ok' }, token: 'secret' })).toEqual({
    nested: { apiKey: '[REDACTED]', safe: 'ok' },
    token: '[REDACTED]',
  });
});
