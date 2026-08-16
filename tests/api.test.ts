import type { AIProvider } from '@nox/ai';
import { buildApp } from '../apps/api/src/app.js';
import { InMemoryMemoryStore } from '@nox/memory';
import type { Env } from '@nox/shared';

const env: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  PERSISTENCE_DRIVER: 'in-memory',
  RUN_DATABASE_MIGRATIONS: false,
  OPENROUTER_API_KEY: 'test',
  OPENROUTER_MODEL: 'test',
  MODEL_STT: 'test-stt',
  MODEL_TTS: 'test-tts',
  OPENROUTER_BASE_URL: 'https://example.com',
  OPENROUTER_APP_NAME: 'NOX',
  NOX_API_TOKEN: 'test-token-with-at-least-32-characters',
  NOX_USER_ID: 'owner',
  NOX_DEVICE_ID: 'test-device',
  ACTION_TOOLS_AUTO_ALLOWED: false,
  CONFIRMATION_TTL_SECONDS: 300,
  CONVERSATION_CONTEXT_MESSAGES: 20,
  VOICE_LANGUAGE: 'pt',
  VOICE_TTS_VOICE: 'alloy',
  VOICE_MAX_UPLOAD_BYTES: 2_000_000,
  VOICE_MAX_TTS_CHARACTERS: 4_000,
};
const provider: AIProvider = {
  async chat() {
    return { message: { role: 'assistant', content: 'Olá!' } };
  },
  async *stream() {
    yield '';
  },
};

describe('HTTP API', () => {
  it('reports its status and version', async () => {
    const app = buildApp({ ...env, APP_VERSION: 'test-sha' }, { provider });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: 'test-sha' });
    await app.close();
  });

  it('validates input and serves chat', async () => {
    const app = buildApp(env, { provider });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: 'Oi' } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/chat',
          headers: { authorization: `Bearer ${env.NOX_API_TOKEN}` },
          payload: { message: '' },
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: {
        authorization: `Bearer ${env.NOX_API_TOKEN}`,
        'x-session-id': '11111111-1111-4111-8111-111111111111',
      },
      payload: { message: 'Oi' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-session-id']).toBe('11111111-1111-4111-8111-111111111111');
    const body = response.json<{
      type: string;
      content: string;
      conversationId: string;
      requestId: string;
    }>();
    expect(body).toMatchObject({ type: 'message', content: 'Olá!' });
    expect(body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });

  it('does not reveal conversations owned by another authenticated user', async () => {
    const memory = new InMemoryMemoryStore();
    const ownerApp = buildApp(env, { provider, memory });
    const created = await ownerApp.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: `Bearer ${env.NOX_API_TOKEN}` },
      payload: { message: 'Conversa privada' },
    });
    const conversationId = created.json<{ conversationId: string }>().conversationId;
    const missing = await ownerApp.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: `Bearer ${env.NOX_API_TOKEN}` },
      payload: {
        conversationId: '11111111-1111-4111-8111-111111111111',
        message: 'Conversa inexistente',
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'CONVERSATION_NOT_FOUND' });
    await ownerApp.close();

    const attackerEnv: Env = {
      ...env,
      NOX_API_TOKEN: 'attacker-token-with-at-least-32-characters',
      NOX_USER_ID: 'attacker',
    };
    const attackerApp = buildApp(attackerEnv, { provider, memory });
    const response = await attackerApp.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: `Bearer ${attackerEnv.NOX_API_TOKEN}` },
      payload: { conversationId, message: 'Tente abrir' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'CONVERSATION_NOT_FOUND' });
    await attackerApp.close();
  });
});
