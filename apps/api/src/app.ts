import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import packageMetadata from '../../../package.json' with { type: 'json' };
import { AgentRuntime } from '@nox/agent';
import {
  ConfiguredModelRouter,
  OpenRouterProvider,
  type AIProvider,
  type ModelCapability,
  type ModelRouter,
} from '@nox/ai';
import { InMemoryAuditRepository, type AuditRepository } from '@nox/audit';
import { InMemoryConfirmationRepository, type ConfirmationRepository } from '@nox/confirmations';
import { createPostgresRepositories } from '@nox/database';
import { StaticTokenAuthenticator, type IdentityContext } from '@nox/identity';
import { ConversationNotFoundError, InMemoryMemoryStore, type MemoryStore } from '@nox/memory';
import { DefaultPermissionEngine, type PermissionEngine } from '@nox/permissions';
import type { Env } from '@nox/shared';
import { ToolRegistry, createMockTools } from '@nox/tools';
import { InMemoryAIUsageRepository, type AIUsageRepository } from '@nox/usage';

const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(20_000),
});
const confirmationSchema = z.object({ approved: z.boolean() });
type Overrides = {
  provider?: AIProvider;
  audit?: AuditRepository;
  confirmations?: ConfirmationRepository;
  memory?: MemoryStore;
  permissions?: PermissionEngine;
  router?: ModelRouter;
  usage?: AIUsageRepository;
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
        baseUrl: env.OPENROUTER_BASE_URL,
        appName: env.OPENROUTER_APP_NAME,
        ...(env.OPENROUTER_SITE_URL ? { siteUrl: env.OPENROUTER_SITE_URL } : {}),
      }),
    router: overrides.router ?? new ConfiguredModelRouter(modelConfiguration(env)),
    tools,
    permissions:
      overrides.permissions ??
      new DefaultPermissionEngine({ allowActionTools: env.ACTION_TOOLS_AUTO_ALLOWED }),
    confirmations:
      overrides.confirmations ??
      postgresRepositories?.confirmations ??
      new InMemoryConfirmationRepository(ttlMs),
    audit: overrides.audit ?? postgresRepositories?.audit ?? new InMemoryAuditRepository(),
    memory: overrides.memory ?? postgresRepositories?.memory ?? new InMemoryMemoryStore(),
    usage: overrides.usage ?? postgresRepositories?.usage ?? new InMemoryAIUsageRepository(),
    contextMessageLimit: env.CONVERSATION_CONTEXT_MESSAGES,
    onTelemetryError: (error) => app.log.error({ err: error }, 'Could not persist AI usage'),
  });
  app.get('/health', async () => ({
    status: 'ok',
    version: env.APP_VERSION ?? packageMetadata.version,
  }));
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
    try {
      return await runtime.run({
        ...identity,
        message: parsed.data.message,
        ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
      });
    } catch (error) {
      if (error instanceof ConversationNotFoundError)
        return reply.code(404).send({ error: 'CONVERSATION_NOT_FOUND' });
      throw error;
    }
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

function modelConfiguration(
  env: Env,
): Partial<Record<ModelCapability, string>> & { DEFAULT: string } {
  const models: Partial<Record<ModelCapability, string>> & { DEFAULT: string } = {
    DEFAULT: env.MODEL_DEFAULT ?? env.OPENROUTER_MODEL,
  };
  if (env.MODEL_FAST) models.FAST = env.MODEL_FAST;
  if (env.MODEL_REASONING) models.REASONING = env.MODEL_REASONING;
  if (env.MODEL_CODING) models.CODING = env.MODEL_CODING;
  if (env.MODEL_VISION) models.VISION = env.MODEL_VISION;
  if (env.MODEL_MEMORY) models.MEMORY = env.MODEL_MEMORY;
  if (env.MODEL_STT) models.STT = env.MODEL_STT;
  if (env.MODEL_TTS) models.TTS = env.MODEL_TTS;
  return models;
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
