import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AgentRuntime } from '@jarvis/agent';
import { OpenRouterProvider, type AIProvider } from '@jarvis/ai';
import { InMemoryAuditRepository, type AuditRepository } from '@jarvis/audit';
import { InMemoryConfirmationRepository, type ConfirmationRepository } from '@jarvis/confirmations';
import { createPostgresRepositories } from '@jarvis/database';
import { InMemoryMemoryStore, type MemoryStore } from '@jarvis/memory';
import { DefaultPermissionEngine, type PermissionEngine } from '@jarvis/permissions';
import type { Env } from '@jarvis/shared';
import { ToolRegistry, createMockTools } from '@jarvis/tools';

const chatSchema = z.object({ message: z.string().min(1).max(20_000) });
const confirmationSchema = z.object({ approved: z.boolean() });
type Overrides = {
  provider?: AIProvider;
  audit?: AuditRepository;
  confirmations?: ConfirmationRepository;
  memory?: MemoryStore;
  permissions?: PermissionEngine;
};

export function buildApp(env: Env, overrides: Overrides = {}): FastifyInstance {
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });
  const tools = new ToolRegistry();
  for (const tool of createMockTools()) tools.register(tool);
  const ttlMs = env.CONFIRMATION_TTL_SECONDS * 1000;
  const postgresRepositories =
    env.PERSISTENCE_DRIVER === 'postgres'
      ? createPostgresRepositories(requireDatabaseUrl(env.DATABASE_URL), ttlMs)
      : undefined;
  if (postgresRepositories) app.addHook('onClose', async () => postgresRepositories.close());
  const runtime = new AgentRuntime({
    provider:
      overrides.provider ??
      new OpenRouterProvider({
        apiKey: env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_MODEL,
        baseUrl: env.OPENROUTER_BASE_URL,
        appName: env.OPENROUTER_APP_NAME,
        ...(env.OPENROUTER_SITE_URL ? { siteUrl: env.OPENROUTER_SITE_URL } : {}),
      }),
    tools,
    permissions:
      overrides.permissions ??
      new DefaultPermissionEngine({ allowActionTools: env.ACTION_TOOLS_AUTO_ALLOWED }),
    confirmations:
      overrides.confirmations ??
      postgresRepositories?.confirmations ??
      new InMemoryConfirmationRepository(ttlMs),
    audit: overrides.audit ?? postgresRepositories?.audit ?? new InMemoryAuditRepository(),
    memory: overrides.memory ?? new InMemoryMemoryStore(),
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/v1/chat', async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.issues });
    return runtime.run({
      userId: userId(request.headers['x-user-id']),
      message: parsed.data.message,
    });
  });
  app.post('/v1/confirmations/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = confirmationSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await runtime.confirm({
      userId: userId(request.headers['x-user-id']),
      confirmationId: params.data.id,
      approve: body.data.approved,
    });
    if (result.type === 'error')
      return reply
        .code(result.code === 'NOT_FOUND' ? 404 : result.code === 'EXPIRED' ? 410 : 409)
        .send(result);
    return result;
  });
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    void reply
      .code(500)
      .send({ error: 'INTERNAL_ERROR', message: 'Não foi possível processar a solicitação.' });
  });
  return app;
}
function userId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.slice(0, 128) || 'local-user';
}
function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('DATABASE_URL is required when PERSISTENCE_DRIVER=postgres');
  return value;
}
