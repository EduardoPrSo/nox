import type { AIProvider } from '@nox/ai';
import { buildApp } from '../apps/api/src/app.js';
import type { Env } from '@nox/shared';

const env: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  PERSISTENCE_DRIVER: 'in-memory',
  OPENROUTER_API_KEY: 'test',
  OPENROUTER_MODEL: 'test',
  OPENROUTER_BASE_URL: 'https://example.com',
  OPENROUTER_APP_NAME: 'NOX',
  ACTION_TOOLS_AUTO_ALLOWED: false,
  CONFIRMATION_TTL_SECONDS: 300,
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
    const app = buildApp(env, { provider });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '0.1.0' });
    await app.close();
  });

  it('validates input and serves chat', async () => {
    const app = buildApp(env, { provider });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/chat', payload: { message: '' } })).statusCode,
    ).toBe(400);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { 'x-user-id': 'u1' },
      payload: { message: 'Oi' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ type: 'message', content: 'Olá!' });
    await app.close();
  });
});
