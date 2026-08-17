import type { AIProvider, ChatRequest, ChatResponse } from '@nox/ai';
import { ConfiguredModelRouter } from '@nox/ai';
import type { EmbeddingProvider } from '@nox/embeddings';
import {
  EkoAmbientService,
  EkoNotAmbientError,
  EkoRateLimiter,
  EkoStateMachine,
  EnergyVadSegmenter,
  InMemoryEkoStateRepository,
  InvalidEkoTransitionError,
  TimedRingBuffer,
} from '@nox/eko';
import {
  InMemoryLongTermMemoryRepository,
  ModelMemoryClassifier,
  SemanticMemorySearch,
  containsSensitiveInformation,
  type MemoryClassification,
  type MemoryClassifier,
} from '@nox/memory';
import { loadEnv } from '@nox/shared';
import { InMemoryAIUsageRepository } from '@nox/usage';
import type { SpeechToTextProvider, TextToSpeechProvider, TranscriptionRequest } from '@nox/voice';
import { buildApp } from '../apps/api/src/app.js';

const identity = {
  userId: 'owner',
  deviceId: 'desktop',
  sessionId: '11111111-1111-4111-8111-111111111111',
};

class QueueProvider implements AIProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly responses: ChatResponse[]) {}
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('No queued response');
    return response;
  }
  async *stream() {
    yield '';
  }
}

class MockStt implements SpeechToTextProvider {
  readonly requests: TranscriptionRequest[] = [];
  constructor(private readonly text: string) {}
  async transcribe(request: TranscriptionRequest) {
    this.requests.push(request);
    return {
      text: this.text,
      usage: {
        provider: 'mock-stt',
        model: request.model,
        inputTokens: 10,
        totalTokens: 10,
        inputUnits: '2',
        unit: 'seconds',
        latencyMs: 2,
        cost: '0.00001',
      },
    };
  }
}

class MockEmbeddings implements EmbeddingProvider {
  readonly texts: string[] = [];
  constructor(private readonly vector = [1, 0, 0]) {}
  async embed(input: { model: string; text: string }) {
    this.texts.push(input.text);
    return {
      embedding: [...this.vector],
      usage: {
        provider: 'mock-embeddings',
        model: input.model,
        inputTokens: 8,
        totalTokens: 8,
        latencyMs: 1,
        cost: '0.000001',
      },
    };
  }
}

class FixedClassifier implements MemoryClassifier {
  constructor(private readonly classification: MemoryClassification) {}
  async classify() {
    return { classification: this.classification };
  }
}

describe('Eko state machine and local audio primitives', () => {
  it('requires explicit activation and returns ACTIVE to its previous state', () => {
    const machine = new EkoStateMachine();
    expect(machine.transition('AMBIENT')).toBe('AMBIENT');
    expect(() => machine.transition('ACTIVE')).toThrow(InvalidEkoTransitionError);
    expect(machine.transition('ACTIVE', { explicitActivation: true })).toBe('ACTIVE');
    expect(machine.completeActive()).toBe('AMBIENT');
    expect(machine.transition('OFF')).toBe('OFF');
    expect(machine.transition('ACTIVE', { explicitActivation: true })).toBe('ACTIVE');
    expect(machine.completeActive()).toBe('OFF');
  });

  it('detects speech, rejects tiny segments and caps long segments', () => {
    const vad = new EnergyVadSegmenter({
      speechThreshold: 0.05,
      minimumSpeechMs: 300,
      silenceTimeoutMs: 200,
      maximumSegmentMs: 1_000,
    });
    expect(vad.process({ level: 0.01, durationMs: 100, timestampMs: 0 })).toEqual([]);
    expect(vad.process({ level: 0.1, durationMs: 100, timestampMs: 100 })[0]?.type).toBe(
      'speech_start',
    );
    vad.process({ level: 0.1, durationMs: 100, timestampMs: 200 });
    vad.process({ level: 0.1, durationMs: 100, timestampMs: 300 });
    vad.process({ level: 0.01, durationMs: 100, timestampMs: 400 });
    expect(vad.process({ level: 0.01, durationMs: 100, timestampMs: 500 })[0]).toMatchObject({
      type: 'speech_end',
      reason: 'silence',
    });
    vad.process({ level: 0.1, durationMs: 100, timestampMs: 1_000 });
    expect(vad.process({ level: 0.01, durationMs: 100, timestampMs: 1_050 })).toEqual([]);
    expect(vad.process({ level: 0.01, durationMs: 100, timestampMs: 1_150 })[0]).toMatchObject({
      type: 'discard',
      reason: 'too_short',
    });
    vad.process({ level: 0.1, durationMs: 100, timestampMs: 2_000 });
    expect(vad.process({ level: 0.1, durationMs: 900, timestampMs: 2_100 })[0]).toMatchObject({
      type: 'speech_end',
      reason: 'maximum',
    });
  });

  it('keeps only the configured local lookback', () => {
    const ring = new TimedRingBuffer<string>(1_000);
    ring.push('a', 400);
    ring.push('b', 400);
    ring.push('c', 400);
    expect(ring.snapshot()).toEqual(['b', 'c']);
    expect(ring.snapshot(400)).toEqual(['c']);
    ring.clear();
    expect(ring.durationMs).toBe(0);
  });

  it('enforces segment, STT-minute and extraction budgets', () => {
    let now = 1_000_000;
    const limiter = new EkoRateLimiter(
      {
        maxSttMinutesPerHour: 0.01,
        maxSegmentsPerMinute: 2,
        maxMemoryExtractionsPerHour: 1,
      },
      () => now,
    );
    expect(limiter.admitSegment('u', 'd', 200)).toBeUndefined();
    expect(limiter.admitSegment('u', 'd', 200)).toBeUndefined();
    expect(limiter.admitSegment('u', 'd', 100)).toBe('SEGMENTS_PER_MINUTE');
    now += 61_000;
    expect(limiter.admitSegment('u', 'd', 300)).toBe('STT_MINUTES_PER_HOUR');
    expect(limiter.admitExtraction('u', 'd')).toBeUndefined();
    expect(limiter.admitExtraction('u', 'd')).toBe('EXTRACTIONS_PER_HOUR');
  });
});

describe('Memory classifier', () => {
  const router = new ConfiguredModelRouter({ DEFAULT: 'luna', MEMORY: 'luna' });

  it('discards trivial and sensitive content before calling the model', async () => {
    const provider = new QueueProvider([]);
    const classifier = new ModelMemoryClassifier({ provider, router });
    await expect(classifier.classify({ transcript: 'kkkkkk' })).resolves.toMatchObject({
      classification: { decision: 'DISCARD', reason: 'trivial_content' },
    });
    await expect(
      classifier.classify({ transcript: 'Minha senha é super-secreta-123' }),
    ).resolves.toMatchObject({
      classification: { decision: 'DISCARD', reason: 'sensitive_information' },
    });
    expect(provider.requests).toHaveLength(0);
    expect(containsSensitiveInformation('Cartão 4242 4242 4242 4242')).toBe(true);
  });

  it('accepts valid structured KEEP and preserves unknown-speaker language', async () => {
    const provider = new QueueProvider([
      {
        message: {
          role: 'assistant',
          content: JSON.stringify({
            decision: 'KEEP',
            type: 'EVENT',
            importance: 0.82,
            confidence: 0.91,
            content: 'Fulano bateu o carro ontem e está bem.',
            reason: 'future_value',
          }),
        },
      },
    ]);
    const result = await new ModelMemoryClassifier({ provider, router }).classify({
      transcript: 'Você viu que o Fulano bateu o carro ontem? Mas ele está bem.',
    });
    expect(result.classification).toMatchObject({
      decision: 'KEEP',
      type: 'EVENT',
      importance: 0.82,
      confidence: 0.91,
    });
    expect(result.classification.content).toMatch(/^Foi mencionado que/);
    expect(provider.requests[0]?.responseSchema?.name).toBe('ambient_memory_classification');
  });

  it('fails closed for low confidence and invalid model output', async () => {
    const provider = new QueueProvider([
      {
        message: {
          role: 'assistant',
          content: JSON.stringify({
            decision: 'KEEP',
            type: 'FACT',
            importance: 0.8,
            confidence: 0.2,
            content: 'Foi mencionado que João é vegetariano.',
            reason: 'possible_fact',
          }),
        },
      },
      { message: { role: 'assistant', content: 'not-json' } },
    ]);
    const classifier = new ModelMemoryClassifier({ provider, router });
    await expect(
      classifier.classify({ transcript: 'Talvez João seja vegetariano' }),
    ).resolves.toMatchObject({
      classification: { decision: 'DISCARD', reason: 'below_confidence_or_importance_threshold' },
    });
    await expect(classifier.classify({ transcript: 'João é vegetariano' })).resolves.toMatchObject({
      classification: { decision: 'DISCARD', reason: 'invalid_model_output' },
    });
  });
});

describe('Ambient pipeline, persistence and retrieval', () => {
  function service(
    options: {
      state?: 'OFF' | 'AMBIENT';
      repository?: InMemoryLongTermMemoryRepository;
      classifier?: MemoryClassifier;
      stt?: MockStt;
      embeddings?: MockEmbeddings;
      usage?: InMemoryAIUsageRepository;
    } = {},
  ) {
    const states = new InMemoryEkoStateRepository();
    void states.set(identity.userId, identity.deviceId, options.state ?? 'AMBIENT');
    return {
      states,
      service: new EkoAmbientService({
        states,
        repository: options.repository ?? new InMemoryLongTermMemoryRepository(),
        stt: options.stt ?? new MockStt('João gosta de sushi.'),
        classifier:
          options.classifier ??
          new FixedClassifier({
            decision: 'KEEP',
            type: 'PREFERENCE',
            importance: 0.8,
            confidence: 0.9,
            content: 'Foi mencionado que João gosta de sushi.',
            reason: 'future_value',
          }),
        embeddings: options.embeddings ?? new MockEmbeddings(),
        router: new ConfiguredModelRouter({ DEFAULT: 'luna', STT: 'stt' }),
        usage: options.usage ?? new InMemoryAIUsageRepository(),
        rateLimiter: new EkoRateLimiter({
          maxSttMinutesPerHour: 15,
          maxSegmentsPerMinute: 6,
          maxMemoryExtractionsPerHour: 30,
        }),
        language: 'pt',
        embeddingModel: 'embedding',
        transcriptRetentionMs: 3_600_000,
      }),
    };
  }

  const audio = {
    audio: new Uint8Array(validWav()),
    format: 'wav' as const,
    mimeType: 'audio/wav',
    durationMs: 2_000,
  };

  it('OFF never transcribes and AMBIENT creates no response surface', async () => {
    const stt = new MockStt('ligue o ar');
    const setup = service({ state: 'OFF', stt });
    await expect(setup.service.processSegment({ ...identity, ...audio })).rejects.toBeInstanceOf(
      EkoNotAmbientError,
    );
    expect(stt.requests).toHaveLength(0);
  });

  it('creates, owns, deduplicates, expires and deletes long-term memories', async () => {
    const repository = new InMemoryLongTermMemoryRepository();
    const setup = service({ repository });
    const first = await setup.service.processSegment({ ...identity, ...audio });
    const second = await setup.service.processSegment({ ...identity, ...audio });
    expect(first).toMatchObject({ decision: 'KEEP', deduplicated: false });
    expect(second).toMatchObject({ decision: 'KEEP', deduplicated: true });
    const owned = await repository.listLongTermMemories(identity.userId, 10);
    expect(owned).toHaveLength(1);
    expect(owned[0]?.metadata.reinforcementCount).toBe(1);
    expect(await repository.listLongTermMemories('attacker', 10)).toEqual([]);
    expect(await repository.deleteLongTermMemory(owned[0]!.id, 'attacker')).toBe(false);
    expect(await repository.deleteLongTermMemoriesBySource(identity.userId, 'eko')).toBe(1);
    expect(await repository.listLongTermMemories(identity.userId, 10)).toEqual([]);

    const expiredTranscript = await repository.createAmbientTranscript({
      ...identity,
      text: 'temporário',
      durationMs: 1_000,
      sourceTimestamp: new Date(0),
      expiresAt: new Date(1),
      metadata: {},
    });
    expect(expiredTranscript.decision).toBe('PENDING');
    expect(await repository.deleteExpiredTranscripts(new Date(2))).toBe(1);
  });

  it('retrieves semantically with ownership and weighted ranking', async () => {
    const repository = new InMemoryLongTermMemoryRepository();
    await repository.createLongTermMemory({
      ...identity,
      type: 'EVENT',
      content: 'Foi mencionado que Fulano bateu o carro e está bem.',
      importance: 0.9,
      confidence: 0.9,
      source: 'eko',
      sourceTimestamp: new Date(),
      embedding: [1, 0, 0],
      embeddingModel: 'embedding',
      metadata: {},
    });
    await repository.createLongTermMemory({
      userId: 'attacker',
      deviceId: 'other',
      type: 'FACT',
      content: 'Segredo de outro usuário',
      importance: 1,
      confidence: 1,
      source: 'eko',
      sourceTimestamp: new Date(),
      embedding: [1, 0, 0],
      embeddingModel: 'embedding',
      metadata: {},
    });
    const usage = new InMemoryAIUsageRepository();
    const search = new SemanticMemorySearch({
      repository,
      embeddings: new MockEmbeddings([1, 0, 0]),
      embeddingModel: 'embedding',
      usage,
    });
    const result = await search.search({
      ...identity,
      requestId: '22222222-2222-4222-8222-222222222222',
      query: 'O que aconteceu com Fulano?',
      limit: 1,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.userId).toBe('owner');
    expect(result[0]?.score).toBeGreaterThan(0.8);
    expect(usage.records[0]?.operation).toBe('memory_retrieval');
  });
});

describe('Eko HTTP response gating', () => {
  it('ambient audio yields zero AgentRuntime calls, zero tools, zero confirmations and zero TTS', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      OPENROUTER_API_KEY: 'test',
      OPENROUTER_MODEL: 'luna',
      MODEL_STT: 'stt',
      MODEL_TTS: 'tts',
      MODEL_EMBEDDING: 'embedding',
      NOX_API_TOKEN: 'test-token-with-at-least-32-characters',
      NOX_DEVICE_ID: identity.deviceId,
    });
    const provider = new QueueProvider([]);
    let ttsCalls = 0;
    const tts: TextToSpeechProvider = {
      async synthesize() {
        ttsCalls++;
        throw new Error('TTS must never run');
      },
    };
    const states = new InMemoryEkoStateRepository();
    const repository = new InMemoryLongTermMemoryRepository();
    const app = buildApp(env, {
      provider,
      stt: new MockStt('Está muito quente, alguém liga esse ar.'),
      tts,
      embeddings: new MockEmbeddings(),
      ekoStates: states,
      longTermMemory: repository,
      memoryClassifier: new FixedClassifier({
        decision: 'DISCARD',
        importance: 0.2,
        confidence: 0.9,
        content: '',
        reason: 'ambient_action_request',
      }),
    });
    const authorization = { authorization: `Bearer ${env.NOX_API_TOKEN}` };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/eko/state',
          headers: authorization,
          payload: { state: 'AMBIENT' },
        })
      ).statusCode,
    ).toBe(200);
    const upload = multipartEko(validWav(), 'audio/wav', 2_000);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/eko/segments',
      headers: { ...authorization, 'content-type': upload.contentType },
      payload: upload.body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      decision: 'DISCARD',
      reason: 'ambient_action_request',
    });
    expect(provider.requests).toHaveLength(0);
    expect(ttsCalls).toBe(0);
    expect(await repository.listLongTermMemories(identity.userId, 10)).toEqual([]);
    await app.close();
  });
});

function validWav(size = 44): Buffer {
  const audio = Buffer.alloc(size);
  audio.write('RIFF', 0, 'ascii');
  audio.write('WAVE', 8, 'ascii');
  return audio;
}

function multipartEko(audio: Buffer, mimeType: string, durationMs: number) {
  const boundary = '----nox-eko-test-boundary';
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="durationMs"\r\n\r\n${durationMs}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="eko.wav"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
