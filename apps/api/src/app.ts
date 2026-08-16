import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import packageMetadata from '../../../package.json' with { type: 'json' };
import { AgentRuntime } from '@nox/agent';
import { OpenRouterProvider, type AIProvider } from '@nox/ai';
import { InMemoryAuditRepository, type AuditRepository } from '@nox/audit';
import { InMemoryConfirmationRepository, type ConfirmationRepository } from '@nox/confirmations';
import { createPostgresRepositories } from '@nox/database';
import { StaticTokenAuthenticator, type IdentityContext } from '@nox/identity';
import { InMemoryMemoryStore, type MemoryStore } from '@nox/memory';
import { DefaultPermissionEngine, type PermissionEngine } from '@nox/permissions';
import type { Env } from '@nox/shared';
import { ToolRegistry, createMockTools } from '@nox/tools';

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
  const authenticator = new StaticTokenAuthenticator(env.NOX_API_TOKEN, {
    userId: env.NOX_USER_ID,
    deviceId: env.NOX_DEVICE_ID,
  });
  const requestIdentities = new WeakMap<object, IdentityContext>();
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
    // TODO(Eko/Ambient Memory): use a PostgreSQL MemoryStore when persistence is enabled.
    memory: overrides.memory ?? new InMemoryMemoryStore(),
  });
  app.get('/health', async () => ({ status: 'ok', version: packageMetadata.version }));
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    const sessionHeader = request.headers['x-session-id'];
    const result = authenticator.authenticate(
      request.headers.authorization,
      Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader,
    );
    if (!result.authenticated) {
      const invalidSession = result.reason === 'INVALID_SESSION';
      await reply
        .code(invalidSession ? 400 : 401)
        .send({ error: invalidSession ? 'INVALID_SESSION' : 'UNAUTHORIZED' });
      return;
    }
    requestIdentities.set(request, result.identity);
  });
  app.post('/v1/chat', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'INVALID_INPUT', details: parsed.error.issues });
    return runtime.run({
      ...identity,
      message: parsed.data.message,
    });
  });
  app.post('/v1/confirmations/:id', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = confirmationSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await runtime.confirm({
      ...identity,
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
function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('DATABASE_URL is required when PERSISTENCE_DRIVER=postgres');
  return value;
}

function identityFor(
  identities: WeakMap<object, IdentityContext>,
  request: object,
): IdentityContext {
  const identity = identities.get(request);
  if (!identity) throw new Error('Authenticated identity is missing');
  return identity;
}
