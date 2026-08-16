import type { AIProvider, ChatRequest, ChatResponse } from '@nox/ai';
import { AgentRuntime } from '@nox/agent';
import { InMemoryAuditRepository, sanitize } from '@nox/audit';
import { InMemoryConfirmationRepository } from '@nox/confirmations';
import { InMemoryMemoryStore } from '@nox/memory';
import { DefaultPermissionEngine } from '@nox/permissions';
import { ToolRegistry, createMockTools } from '@nox/tools';

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
const identity = (userId = 'u1') => ({
  userId,
  deviceId: 'test-device',
  sessionId: '11111111-1111-4111-8111-111111111111',
});

function runtime(provider: AIProvider, allowActionTools = false) {
  const tools = new ToolRegistry();
  for (const tool of createMockTools(() => new Date('2026-08-15T12:00:00Z'))) tools.register(tool);
  const audit = new InMemoryAuditRepository();
  return {
    audit,
    runtime: new AgentRuntime({
      provider,
      tools,
      audit,
      memory: new InMemoryMemoryStore(),
      confirmations: new InMemoryConfirmationRepository(),
      permissions: new DefaultPermissionEngine({ allowActionTools }),
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
    await expect(
      subject.runtime.confirm({
        ...identity(),
        confirmationId: pending.confirmationId,
        approve: true,
      }),
    ).resolves.toMatchObject({ type: 'message', content: 'Mensagem enviada.' });
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
});

it('redacts sensitive fields recursively', () => {
  expect(sanitize({ nested: { apiKey: 'secret', safe: 'ok' }, token: 'secret' })).toEqual({
    nested: { apiKey: '[REDACTED]', safe: 'ok' },
    token: '[REDACTED]',
  });
});
