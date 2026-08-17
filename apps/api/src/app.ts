import multipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import packageMetadata from '../../../package.json' with { type: 'json' };
import { AgentRuntime } from '@nox/agent';
import {
  AIProviderError,
  ConfiguredModelRouter,
  DefaultModelCapabilityPolicy,
  ModelCapabilityUnavailableError,
  OpenRouterProvider,
  type AIProvider,
  type ModelCapability,
  type ModelCapabilityPolicy,
  type ModelRouter,
} from '@nox/ai';
import { InMemoryAuditRepository, type AuditRepository } from '@nox/audit';
import {
  BridgeClimateProvider,
  InMemoryDeviceCommandBroker,
  MockClimateProvider,
  bridgeResultSchema,
  createClimateTools,
  type ClimateProvider,
  type BridgeCommandResult,
  type DeviceCommandBroker,
} from '@nox/climate';
import { InMemoryConfirmationRepository, type ConfirmationRepository } from '@nox/confirmations';
import { createPostgresRepositories } from '@nox/database';
import {
  DeterministicEmbeddingProvider,
  EmbeddingProviderError,
  OpenRouterEmbeddingProvider,
  type EmbeddingProvider,
} from '@nox/embeddings';
import {
  EkoAmbientService,
  EkoNotAmbientError,
  EkoRateLimitError,
  EkoRateLimiter,
  EkoStateMachine,
  InMemoryEkoStateRepository,
  type EkoStateRepository,
} from '@nox/eko';
import { StaticTokenAuthenticator, type IdentityContext } from '@nox/identity';
import {
  ConversationNotFoundError,
  InMemoryLongTermMemoryRepository,
  InMemoryMemoryStore,
  ModelMemoryClassifier,
  SemanticMemorySearch,
  type LongTermMemoryRepository,
  type MemoryClassifier,
  type MemorySearch,
  type MemoryStore,
} from '@nox/memory';
import { DefaultPermissionEngine, type PermissionEngine } from '@nox/permissions';
import type { Env } from '@nox/shared';
import { ToolRegistry, createMockTools } from '@nox/tools';
import { InMemoryAIUsageRepository, type AIUsageRepository } from '@nox/usage';
import {
  EmptyTranscriptionError,
  InvalidVoiceAudioError,
  OpenRouterSpeechToTextProvider,
  OpenRouterTextToSpeechProvider,
  SpeechProviderError,
  VoiceService,
  VoiceStageError,
  type SpeechToTextProvider,
  type TextToSpeechProvider,
  validateVoiceAudio,
} from '@nox/voice';
import { VOICE_CLIENT_HTML } from './voice-client.js';
import { EKO_CLIENT_HTML } from './eko-client.js';

const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(20_000),
});
const confirmationSchema = z.object({
  approved: z.boolean(),
  interactionMode: z.enum(['text', 'voice']).default('text'),
});
const ekoStateSchema = z.object({ state: z.enum(['OFF', 'AMBIENT']) }).strict();
const listLimitSchema = z.coerce.number().int().min(1).max(100).default(20);
type Overrides = {
  provider?: AIProvider;
  audit?: AuditRepository;
  confirmations?: ConfirmationRepository;
  memory?: MemoryStore;
  permissions?: PermissionEngine;
  router?: ModelRouter;
  modelPolicy?: ModelCapabilityPolicy;
  usage?: AIUsageRepository;
  stt?: SpeechToTextProvider;
  tts?: TextToSpeechProvider;
  climate?: ClimateProvider;
  bridgeBroker?: DeviceCommandBroker;
  embeddings?: EmbeddingProvider;
  memoryClassifier?: MemoryClassifier;
  longTermMemory?: LongTermMemoryRepository;
  memorySearch?: MemorySearch;
  ekoStates?: EkoStateRepository;
};

export function buildApp(env: Env, overrides: Overrides = {}): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
    bodyLimit: env.VOICE_MAX_UPLOAD_BYTES + 100_000,
  });
  void app.register(multipart, {
    limits: { files: 1, fields: 2, fieldSize: 128, fileSize: env.VOICE_MAX_UPLOAD_BYTES },
  });
  const authenticator = new StaticTokenAuthenticator(env.NOX_API_TOKEN, {
    userId: env.NOX_USER_ID,
    deviceId: env.NOX_DEVICE_ID,
  });
  const requestIdentities = new WeakMap<object, IdentityContext>();
  const bridgeBroker =
    overrides.bridgeBroker ?? new InMemoryDeviceCommandBroker(env.DEVICE_BRIDGE_COMMAND_TIMEOUT_MS);
  const climate =
    overrides.climate ??
    (env.CLIMATE_DRIVER === 'bridge'
      ? new BridgeClimateProvider(bridgeBroker, env.NOX_DEVICE_BRIDGE_ID)
      : new MockClimateProvider());
  const tools = new ToolRegistry();
  for (const tool of createMockTools()) tools.register(tool);
  for (const tool of createClimateTools(climate, env.NOX_CLIMATE_DEVICE_ID)) tools.register(tool);
  const ttlMs = env.CONFIRMATION_TTL_SECONDS * 1000;
  const postgresRepositories =
    env.PERSISTENCE_DRIVER === 'postgres'
      ? createPostgresRepositories(requireDatabaseUrl(env.DATABASE_URL), ttlMs)
      : undefined;
  if (postgresRepositories) app.addHook('onClose', async () => postgresRepositories.close());
  app.addHook('onClose', async () => bridgeBroker.close());
  const openRouterOptions = {
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: env.OPENROUTER_BASE_URL,
    appName: env.OPENROUTER_APP_NAME,
    ...(env.OPENROUTER_SITE_URL ? { siteUrl: env.OPENROUTER_SITE_URL } : {}),
  };
  const provider = overrides.provider ?? new OpenRouterProvider(openRouterOptions);
  const router = overrides.router ?? new ConfiguredModelRouter(modelConfiguration(env));
  const usage = overrides.usage ?? postgresRepositories?.usage ?? new InMemoryAIUsageRepository();
  const embeddings =
    overrides.embeddings ??
    (env.NODE_ENV === 'test'
      ? new DeterministicEmbeddingProvider(1536)
      : new OpenRouterEmbeddingProvider({ ...openRouterOptions, dimensions: 1536 }));
  const longTermMemory =
    overrides.longTermMemory ??
    postgresRepositories?.longTermMemory ??
    new InMemoryLongTermMemoryRepository();
  const ekoStates =
    overrides.ekoStates ?? postgresRepositories?.ekoStates ?? new InMemoryEkoStateRepository();
  const memorySearch =
    overrides.memorySearch ??
    new SemanticMemorySearch({
      repository: longTermMemory,
      embeddings,
      embeddingModel: env.MODEL_EMBEDDING,
      usage,
      onTelemetryError: (error) => app.log.error({ err: error }, 'Could not persist memory usage'),
    });
  const stt = overrides.stt ?? new OpenRouterSpeechToTextProvider(openRouterOptions);
  const runtime = new AgentRuntime({
    provider,
    router,
    modelPolicy: overrides.modelPolicy ?? new DefaultModelCapabilityPolicy(),
    reasoningEfforts: {
      FAST: env.MODEL_FAST_REASONING_EFFORT,
      DEFAULT: env.MODEL_DEFAULT_REASONING_EFFORT,
      REASONING: env.MODEL_REASONING_REASONING_EFFORT,
      CODING: env.MODEL_CODING_REASONING_EFFORT,
    },
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
    memorySearch,
    memorySearchLimit: env.EKO_MEMORY_RETRIEVAL_LIMIT,
    usage,
    contextMessageLimit: env.CONVERSATION_CONTEXT_MESSAGES,
    ...(env.CLIMATE_DRIVER === 'bridge'
      ? { toolTimeoutMs: env.DEVICE_BRIDGE_COMMAND_TIMEOUT_MS + 2_000 }
      : {}),
    onTelemetryError: (error) => app.log.error({ err: error }, 'Could not persist AI usage'),
  });
  const voice = new VoiceService({
    runtime,
    router,
    usage,
    stt,
    tts: overrides.tts ?? new OpenRouterTextToSpeechProvider(openRouterOptions),
    language: env.VOICE_LANGUAGE,
    voice: env.VOICE_TTS_VOICE,
    maxTtsCharacters: env.VOICE_MAX_TTS_CHARACTERS,
    onTelemetryError: (error) => app.log.error({ err: error }, 'Could not persist voice usage'),
  });
  const eko = new EkoAmbientService({
    states: ekoStates,
    repository: longTermMemory,
    stt,
    classifier:
      overrides.memoryClassifier ??
      new ModelMemoryClassifier({
        provider,
        router,
        reasoningEffort: env.MODEL_FAST_REASONING_EFFORT ?? 'none',
      }),
    embeddings,
    router,
    usage,
    rateLimiter: new EkoRateLimiter({
      maxSttMinutesPerHour: env.EKO_MAX_STT_MINUTES_PER_HOUR,
      maxSegmentsPerMinute: env.EKO_MAX_SEGMENTS_PER_MINUTE,
      maxMemoryExtractionsPerHour: env.EKO_MAX_MEMORY_EXTRACTIONS_PER_HOUR,
    }),
    language: env.VOICE_LANGUAGE,
    embeddingModel: env.MODEL_EMBEDDING,
    transcriptRetentionMs: env.EKO_TRANSCRIPT_RETENTION_HOURS * 3_600_000,
    deduplicationThreshold: env.EKO_DEDUPLICATION_SIMILARITY,
    onTelemetryError: (error) => app.log.error({ err: error }, 'Could not persist Eko usage'),
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
  app.get('/eko', async (_request, reply) => {
    return reply
      .header('cache-control', 'no-store')
      .header(
        'content-security-policy',
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'none'; frame-ancestors 'none'",
      )
      .header('permissions-policy', 'microphone=(self)')
      .header('referrer-policy', 'no-referrer')
      .type('text/html; charset=utf-8')
      .send(EKO_CLIENT_HTML);
  });
  if (env.CLIMATE_DRIVER === 'bridge' && !env.NOX_DEVICE_BRIDGE_TOKEN)
    throw new Error('NOX_DEVICE_BRIDGE_TOKEN is required when CLIMATE_DRIVER=bridge');
  if (env.NOX_DEVICE_BRIDGE_TOKEN) {
    app.get('/bridge/v1/bridges/:bridgeId/commands/next', async (request, reply) => {
      if (!authenticateBridge(request.headers.authorization, env.NOX_DEVICE_BRIDGE_TOKEN!))
        return reply.code(401).send({ error: 'UNAUTHORIZED' });
      const params = bridgeParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
      if (params.data.bridgeId !== env.NOX_DEVICE_BRIDGE_ID)
        return reply.code(403).send({ error: 'BRIDGE_NOT_ALLOWED' });
      const command = await bridgeBroker.poll(params.data.bridgeId, env.DEVICE_BRIDGE_LONG_POLL_MS);
      void reply.header('cache-control', 'no-store');
      return command ? command : reply.code(204).send();
    });
    app.post('/bridge/v1/bridges/:bridgeId/commands/:commandId/result', async (request, reply) => {
      if (!authenticateBridge(request.headers.authorization, env.NOX_DEVICE_BRIDGE_TOKEN!))
        return reply.code(401).send({ error: 'UNAUTHORIZED' });
      const params = bridgeResultParamsSchema.safeParse(request.params);
      const body = bridgeResultSchema.safeParse(request.body);
      if (!params.success || !body.success || params.data.commandId !== body.data.commandId)
        return reply.code(400).send({ error: 'INVALID_INPUT' });
      if (params.data.bridgeId !== env.NOX_DEVICE_BRIDGE_ID)
        return reply.code(403).send({ error: 'BRIDGE_NOT_ALLOWED' });
      if (!bridgeBroker.complete(params.data.bridgeId, normalizedBridgeResult(body.data)))
        return reply.code(404).send({ error: 'COMMAND_NOT_FOUND' });
      return reply.code(202).send({ accepted: true });
    });
  }
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
  app.get('/v1/eko/state', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    return { state: await ekoStates.get(identity.userId, identity.deviceId) };
  });
  app.get('/v1/eko/config', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    return {
      speechThreshold: env.EKO_VAD_SPEECH_THRESHOLD,
      minimumSpeechMs: env.EKO_VAD_MINIMUM_SPEECH_MS,
      silenceTimeoutMs: env.EKO_VAD_SILENCE_TIMEOUT_MS,
      maximumSegmentMs: env.EKO_VAD_MAXIMUM_SEGMENT_MS,
      ringBufferSeconds: env.EKO_RING_BUFFER_SECONDS,
    };
  });
  app.post('/v1/eko/state', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    const body = ekoStateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const current = await ekoStates.get(identity.userId, identity.deviceId);
    const machine = new EkoStateMachine(current);
    machine.transition(body.data.state);
    return { state: await ekoStates.set(identity.userId, identity.deviceId, body.data.state) };
  });
  app.post('/v1/eko/segments', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    try {
      const input = await readEkoSegmentRequest(request, env.EKO_VAD_MAXIMUM_SEGMENT_MS);
      const result = await eko.processSegment({ ...identity, ...input });
      return { ...result, ...(result.memory ? { memory: publicMemory(result.memory) } : {}) };
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
      if (error instanceof EkoNotAmbientError)
        return reply.code(409).send({ error: 'EKO_NOT_AMBIENT' });
      if (error instanceof EkoRateLimitError)
        return reply.code(429).send({ error: 'EKO_RATE_LIMIT', limit: error.code });
      if (error instanceof ModelCapabilityUnavailableError)
        return reply.code(503).send({ error: 'EKO_NOT_CONFIGURED' });
      if (error instanceof AIProviderError || error instanceof EmbeddingProviderError)
        return reply.code(502).send({ error: 'AI_PROVIDER_FAILED', retryable: error.retryable });
      if (error instanceof SpeechProviderError)
        return reply.code(502).send({
          error: 'STT_FAILED',
          retryable: error.status === undefined || error.status === 429 || error.status >= 500,
        });
      throw error;
    }
  });
  app.get('/v1/eko/transcripts', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    const query = z.object({ limit: listLimitSchema.optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    await longTermMemory.deleteExpiredTranscripts(new Date());
    return {
      transcripts: await longTermMemory.listAmbientTranscripts(
        identity.userId,
        identity.deviceId,
        query.data.limit ?? 20,
      ),
    };
  });
  app.get('/v1/memories', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    const query = z
      .object({
        limit: listLimitSchema.optional(),
        source: z.enum(['conversation', 'eko', 'explicit', 'tool', 'vision']).optional(),
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    await longTermMemory.deleteExpiredLongTermMemories(new Date());
    const memories = await longTermMemory.listLongTermMemories(
      identity.userId,
      query.data.limit ?? 20,
      query.data.source,
    );
    return { memories: memories.map(publicMemory) };
  });
  app.delete('/v1/memories/:id', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (!(await longTermMemory.deleteLongTermMemory(params.data.id, identity.userId)))
      return reply.code(404).send({ error: 'MEMORY_NOT_FOUND' });
    return reply.code(204).send();
  });
  app.delete('/v1/memories', async (request, reply) => {
    const identity = identityFor(requestIdentities, request);
    void reply.header('x-session-id', identity.sessionId);
    const query = z.object({ source: z.literal('eko') }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'SOURCE_EKO_REQUIRED' });
    return {
      deleted: await longTermMemory.deleteLongTermMemoriesBySource(identity.userId, 'eko'),
    };
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
      interactionMode: body.data.interactionMode,
    });
    if (result.type === 'error')
      return reply
        .code(result.code === 'NOT_FOUND' ? 404 : result.code === 'EXPIRED' ? 410 : 409)
        .send(result);
    if (body.data.interactionMode !== 'voice') return result;
    try {
      const spoken = await voice.synthesizeText({
        ...identity,
        requestId: result.requestId,
        conversationId: result.conversationId,
        text: result.content,
      });
      return { ...result, ...spoken };
    } catch (error) {
      app.log.error({ err: error }, 'Could not synthesize confirmation response');
      return { ...result, assistantText: result.content, audio: null, audioError: 'TTS_FAILED' };
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    void reply
      .code(500)
      .send({ error: 'INTERNAL_ERROR', message: 'Não foi possível processar a solicitação.' });
  });
  return app;
}

const bridgeParamsSchema = z.object({ bridgeId: z.string().min(1).max(128) });
const bridgeResultParamsSchema = bridgeParamsSchema.extend({ commandId: z.string().uuid() });

function authenticateBridge(header: string | undefined, expectedToken: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function normalizedBridgeResult(input: z.output<typeof bridgeResultSchema>): BridgeCommandResult {
  const state = input.state
    ? {
        power: input.state.power,
        targetTemperatureCelsius: input.state.targetTemperatureCelsius,
        mode: input.state.mode,
        online: input.state.online,
        ...(input.state.indoorTemperatureCelsius !== undefined
          ? { indoorTemperatureCelsius: input.state.indoorTemperatureCelsius }
          : {}),
        ...(input.state.outdoorTemperatureCelsius !== undefined
          ? { outdoorTemperatureCelsius: input.state.outdoorTemperatureCelsius }
          : {}),
      }
    : undefined;
  return {
    commandId: input.commandId,
    success: input.success,
    confirmed: input.confirmed,
    ...(state ? { state } : {}),
    ...(input.code ? { code: input.code } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
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

async function readEkoSegmentRequest(
  request: FastifyRequest,
  maximumSegmentMs: number,
): Promise<
  ReturnType<typeof validateVoiceAudio> & {
    durationMs: number;
    sourceContext: 'unknown' | 'media';
  }
> {
  if (!request.isMultipart()) throw new VoiceRequestError(415, 'MULTIPART_REQUIRED');
  let audio: Uint8Array | undefined;
  let mimeType: string | undefined;
  let durationMs: number | undefined;
  let sourceContext: 'unknown' | 'media' = 'unknown';
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'audio' || audio)
          throw new VoiceRequestError(400, 'INVALID_MULTIPART');
        audio = new Uint8Array(await part.toBuffer());
        mimeType = part.mimetype;
        continue;
      }
      if (typeof part.value !== 'string') throw new VoiceRequestError(400, 'INVALID_MULTIPART');
      if (part.fieldname === 'durationMs' && durationMs === undefined) {
        const parsed = z.coerce
          .number()
          .int()
          .min(100)
          .max(maximumSegmentMs + 2_000)
          .safeParse(part.value);
        if (!parsed.success) throw new VoiceRequestError(400, 'INVALID_MULTIPART');
        durationMs = parsed.data;
        continue;
      }
      if (part.fieldname === 'sourceContext' && sourceContext === 'unknown') {
        const parsed = z.enum(['unknown', 'media']).safeParse(part.value);
        if (!parsed.success) throw new VoiceRequestError(400, 'INVALID_MULTIPART');
        sourceContext = parsed.data;
        continue;
      }
      throw new VoiceRequestError(400, 'INVALID_MULTIPART');
    }
  } catch (error) {
    if (error instanceof VoiceRequestError || isMultipartLimitError(error)) throw error;
    throw new VoiceRequestError(400, 'INVALID_MULTIPART');
  }
  if (!audio || !mimeType) throw new VoiceRequestError(400, 'AUDIO_REQUIRED');
  if (durationMs === undefined) throw new VoiceRequestError(400, 'INVALID_MULTIPART');
  return { ...validateVoiceAudio(audio, mimeType), durationMs, sourceContext };
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
  models.EMBEDDING = env.MODEL_EMBEDDING;
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

function publicMemory(
  memory: Awaited<ReturnType<LongTermMemoryRepository['listLongTermMemories']>>[number],
) {
  return Object.fromEntries(Object.entries(memory).filter(([key]) => key !== 'embedding'));
}
