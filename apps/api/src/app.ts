import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import packageMetadata from '../../../package.json' with { type: 'json' };
import { AgentRuntime } from '@nox/agent';
import {
  AIProviderError,
  ConfiguredModelRouter,
  ModelCapabilityUnavailableError,
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
import {
  EmptyTranscriptionError,
  InvalidVoiceAudioError,
  OpenRouterSpeechToTextProvider,
  OpenRouterTextToSpeechProvider,
  VoiceService,
  VoiceStageError,
  type SpeechToTextProvider,
  type TextToSpeechProvider,
  validateVoiceAudio,
} from '@nox/voice';
import { VOICE_CLIENT_HTML } from './voice-client.js';

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
  stt?: SpeechToTextProvider;
  tts?: TextToSpeechProvider;
};

export function buildApp(env: Env, overrides: Overrides = {}): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
    bodyLimit: env.VOICE_MAX_UPLOAD_BYTES + 100_000,
  });
  void app.register(multipart, {
    limits: { files: 1, fields: 1, fieldSize: 128, fileSize: env.VOICE_MAX_UPLOAD_BYTES },
  });
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
  const openRouterOptions = {
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
    appName: env.OPENROUTER_APP_NAME,
    ...(env.OPENROUTER_SITE_URL ? { siteUrl: env.OPENROUTER_SITE_URL } : {}),
  };
  const provider = overrides.provider ?? new OpenRouterProvider(openRouterOptions);
  const router = overrides.router ?? new ConfiguredModelRouter(modelConfiguration(env));
  const usage = overrides.usage ?? postgresRepositories?.usage ?? new InMemoryAIUsageRepository();
  const runtime = new AgentRuntime({
    provider,
    router,
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
    usage,
    contextMessageLimit: env.CONVERSATION_CONTEXT_MESSAGES,
    onTelemetryError: (error) => app.log.error({ err: error }, 'Could not persist AI usage'),
  });
  const voice = new VoiceService({
    runtime,
    router,
    usage,
    stt: overrides.stt ?? new OpenRouterSpeechToTextProvider(openRouterOptions),
    tts: overrides.tts ?? new OpenRouterTextToSpeechProvider(openRouterOptions),
    language: env.VOICE_LANGUAGE,
    voice: env.VOICE_TTS_VOICE,
    maxTtsCharacters: env.VOICE_MAX_TTS_CHARACTERS,
    onTelemetryError: (error) => app.log.error({ err: error }, 'Could not persist voice usage'),
  });
  app.get('/health', async () => ({
    status: 'ok',
    version: env.APP_VERSION ?? packageMetadata.version,
  }));
  app.get('/voice', async (_request, reply) => {
    return reply
      .header('cache-control', 'no-store')
      .header(
        'content-security-policy',
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'none'; frame-ancestors 'none'",
      )
      .header('permissions-policy', 'microphone=(self)')
      .header('referrer-policy', 'no-referrer')
      .type('text/html; charset=utf-8')
      .send(VOICE_CLIENT_HTML);
  });
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
      if (error instanceof AIProviderError)
        return reply.code(502).send({ error: 'AI_PROVIDER_FAILED', retryable: error.retryable });
      throw error;
    }
  });
  app.post('/v1/voice', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    try {
      const input = await readVoiceRequest(request);
      return await voice.run({ ...identity, ...input });
    } catch (error) {
      if (isMultipartLimitError(error))
        return reply
          .code(413)
          .send({ error: 'AUDIO_TOO_LARGE', maxBytes: env.VOICE_MAX_UPLOAD_BYTES });
      if (error instanceof VoiceRequestError)
        return reply.code(error.status).send({ error: error.code });
      if (error instanceof InvalidVoiceAudioError)
        return reply
          .code(error.code === 'UNSUPPORTED_AUDIO_TYPE' ? 415 : 400)
          .send({ error: error.code });
      if (error instanceof ConversationNotFoundError)
        return reply.code(404).send({ error: 'CONVERSATION_NOT_FOUND' });
      if (error instanceof ModelCapabilityUnavailableError)
        return reply.code(503).send({ error: 'VOICE_NOT_CONFIGURED' });
      if (error instanceof EmptyTranscriptionError)
        return reply.code(422).send({ error: 'EMPTY_TRANSCRIPTION' });
      if (error instanceof AIProviderError)
        return reply.code(502).send({ error: 'AI_PROVIDER_FAILED', retryable: error.retryable });
      if (error instanceof VoiceStageError) {
        app.log.error({ err: error.cause, stage: error.stage }, 'Voice provider failed');
        return reply.code(502).send({
          error: `${error.stage}_FAILED`,
          retryable: error.stage === 'STT',
          ...(error.partial ?? {}),
        });
      }
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

class VoiceRequestError extends Error {
  constructor(
    readonly status: 400 | 415,
    readonly code: 'MULTIPART_REQUIRED' | 'AUDIO_REQUIRED' | 'INVALID_MULTIPART',
  ) {
    super(code);
    this.name = 'VoiceRequestError';
  }
}

async function readVoiceRequest(
  request: FastifyRequest,
): Promise<ReturnType<typeof validateVoiceAudio> & { conversationId?: string }> {
  if (!request.isMultipart()) throw new VoiceRequestError(415, 'MULTIPART_REQUIRED');
  let audio: Uint8Array | undefined;
  let mimeType: string | undefined;
  let conversationId: string | undefined;
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'audio' || audio)
          throw new VoiceRequestError(400, 'INVALID_MULTIPART');
        audio = new Uint8Array(await part.toBuffer());
        mimeType = part.mimetype;
        continue;
      }
      if (part.fieldname !== 'conversationId' || conversationId || typeof part.value !== 'string')
        throw new VoiceRequestError(400, 'INVALID_MULTIPART');
      const parsed = z.string().uuid().safeParse(part.value);
      if (!parsed.success) throw new VoiceRequestError(400, 'INVALID_MULTIPART');
      conversationId = parsed.data;
    }
  } catch (error) {
    if (error instanceof VoiceRequestError || isMultipartLimitError(error)) throw error;
    throw new VoiceRequestError(400, 'INVALID_MULTIPART');
  }
  if (!audio || !mimeType) throw new VoiceRequestError(400, 'AUDIO_REQUIRED');
  return { ...validateVoiceAudio(audio, mimeType), ...(conversationId ? { conversationId } : {}) };
}

function isMultipartLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return [
    'FST_REQ_FILE_TOO_LARGE',
    'FST_FILES_LIMIT',
    'FST_FIELDS_LIMIT',
    'FST_PARTS_LIMIT',
  ].includes(String(error.code));
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
