import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { AIProvider, ChatRequest, ChatResponse } from '@nox/ai';
import type { Env } from '@nox/shared';
import { buildApp } from '../apps/api/src/app.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const token = `persistence-check-${randomUUID()}`;
const userId = `persistence-check-${randomUUID()}`;
const sessionId = randomUUID();
const headers = { authorization: `Bearer ${token}`, 'x-session-id': sessionId };
const env: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  DATABASE_URL: databaseUrl,
  PERSISTENCE_DRIVER: 'postgres',
  RUN_DATABASE_MIGRATIONS: false,
  OPENROUTER_API_KEY: 'persistence-check',
  OPENROUTER_MODEL: 'persistence-check',
  OPENROUTER_BASE_URL: 'https://example.com',
  OPENROUTER_APP_NAME: 'NOX',
  NOX_API_TOKEN: token,
  NOX_USER_ID: userId,
  NOX_DEVICE_ID: 'persistence-check-device',
  ACTION_TOOLS_AUTO_ALLOWED: false,
  CONFIRMATION_TTL_SECONDS: 300,
  CONVERSATION_CONTEXT_MESSAGES: 20,
};

class OneShotProvider implements AIProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly response: ChatResponse) {}
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    return this.response;
  }
  async *stream(): AsyncIterable<string> {
    yield '';
  }
}

const firstApp = buildApp(env, {
  provider: new OneShotProvider({
    message: {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'persistence-check-call',
          name: 'send_message_mock',
          arguments: { recipient: 'Teste', message: 'Validar persistência' },
        },
      ],
    },
  }),
});

let confirmationId: string | undefined;
let conversationId: string | undefined;
try {
  const response = await firstApp.inject({
    method: 'POST',
    url: '/v1/chat',
    headers,
    payload: { message: 'Crie uma confirmação de teste' },
  });
  const body = response.json<{
    type: string;
    confirmationId?: string;
    conversationId?: string;
  }>();
  if (response.statusCode !== 200 || body.type !== 'confirmation_required') {
    throw new Error(`Could not create confirmation: ${response.body}`);
  }
  confirmationId = body.confirmationId;
  conversationId = body.conversationId;
} finally {
  await firstApp.close();
}

if (!confirmationId || !conversationId) {
  throw new Error('Confirmation and conversation ids were not returned');
}

const secondApp = buildApp(env, {
  provider: new OneShotProvider({
    message: { role: 'assistant', content: 'Persistência confirmada.' },
  }),
});

try {
  const response = await secondApp.inject({
    method: 'POST',
    url: `/v1/confirmations/${confirmationId}`,
    headers,
    payload: { approved: true },
  });
  if (response.statusCode !== 200 || response.json<{ type: string }>().type !== 'message') {
    throw new Error(`Could not resolve persisted confirmation: ${response.body}`);
  }
} finally {
  await secondApp.close();
}

const historyProvider = new OneShotProvider({
  message: { role: 'assistant', content: 'Histórico recuperado.' },
});
const thirdApp = buildApp(env, { provider: historyProvider });
try {
  const response = await thirdApp.inject({
    method: 'POST',
    url: '/v1/chat',
    headers,
    payload: { conversationId, message: 'Continue a conversa persistida' },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Could not continue persisted conversation: ${response.body}`);
  }
  const restoredHistory = historyProvider.requests[0]?.messages ?? [];
  if (!restoredHistory.some((message) => message.content === 'Crie uma confirmação de teste')) {
    throw new Error('Persisted conversation history was not restored after restart');
  }
} finally {
  await thirdApp.close();
}

const sql = postgres(databaseUrl, { prepare: false, max: 1 });
try {
  const confirmationRows = await sql<[{ status: string }]>`
    select status from confirmations where id = ${confirmationId}
  `;
  const auditRows = await sql<[{ count: number }]>`
    select count(*)::int as count from audit_logs where user_id = ${userId}
  `;
  const conversationRows = await sql<[{ id: string; messages: number }]>`
    select c.id, count(m.id)::int as messages
    from conversations c
    left join messages m on m.conversation_id = c.id
    where c.user_id = ${userId}
    group by c.id
  `;
  const usageRows = await sql<[{ count: number }]>`
    select count(*)::int as count from ai_usage where user_id = ${userId}
  `;
  if (
    confirmationRows[0]?.status !== 'approved' ||
    !auditRows[0]?.count ||
    !conversationRows[0]?.messages ||
    !usageRows[0]?.count
  ) {
    throw new Error('PostgreSQL did not retain confirmation, audit, conversation and usage data');
  }
  console.log(
    `Persistence verified across restart: confirmation=${confirmationRows[0].status}, auditEvents=${auditRows[0].count}, messages=${conversationRows[0].messages}, usageEvents=${usageRows[0].count}`,
  );
} finally {
  await sql`delete from ai_usage where user_id = ${userId}`;
  await sql`delete from audit_logs where user_id = ${userId}`;
  await sql`delete from confirmations where user_id = ${userId}`;
  await sql`delete from conversations where user_id = ${userId}`;
  await sql.end();
}
