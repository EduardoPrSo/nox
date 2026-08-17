import { randomUUID } from 'node:crypto';
import type { ModelRouter } from '@nox/ai';
import type { EmbeddingProvider } from '@nox/embeddings';
import type { IdentityContext } from '@nox/identity';
import type {
  AmbientTranscript,
  LongTermMemory,
  LongTermMemoryRepository,
  MemoryClassifier,
} from '@nox/memory';
import type { AIUsageRepository, NewAIUsageRecord } from '@nox/usage';
import type { SpeechToTextProvider, ValidatedAudio } from '@nox/voice';

export const EKO_STATES = ['OFF', 'AMBIENT', 'ACTIVE'] as const;
export type EkoState = (typeof EKO_STATES)[number];
export type StoredEkoState = Exclude<EkoState, 'ACTIVE'>;

export const EKO_ACTIVATION_SOURCES = [
  'wake_word',
  'button',
  'touch',
  'push_to_talk',
  'authorized',
] as const;
export type EkoActivationSource = (typeof EKO_ACTIVATION_SOURCES)[number];
export type EkoActivationEvent = {
  source: EkoActivationSource;
  detectedAt: Date;
};

/** Contract for a local detector; no audio should leave the device before activation. */
export interface WakeWordDetector {
  readonly local: true;
  start(onActivation: (event: EkoActivationEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

export class InvalidEkoTransitionError extends Error {
  constructor(from: EkoState, to: EkoState) {
    super(`Invalid Eko transition: ${from} -> ${to}`);
    this.name = 'InvalidEkoTransitionError';
  }
}

export class EkoStateMachine {
  private returnState: StoredEkoState;

  constructor(
    private current: EkoState = 'OFF',
    ambientReturnState: StoredEkoState = current === 'AMBIENT' ? 'AMBIENT' : 'OFF',
  ) {
    this.returnState = ambientReturnState;
  }

  get state(): EkoState {
    return this.current;
  }

  transition(target: EkoState, options: { explicitActivation?: boolean } = {}): EkoState {
    if (target === this.current) return this.current;
    if (target === 'ACTIVE') {
      if (!options.explicitActivation || this.current === 'ACTIVE')
        throw new InvalidEkoTransitionError(this.current, target);
      this.returnState = this.current;
      this.current = 'ACTIVE';
      return this.current;
    }
    if (this.current === 'ACTIVE') {
      if (target !== this.returnState) throw new InvalidEkoTransitionError(this.current, target);
      this.current = target;
      return this.current;
    }
    if (
      (this.current === 'OFF' && target === 'AMBIENT') ||
      (this.current === 'AMBIENT' && target === 'OFF')
    ) {
      this.current = target;
      return this.current;
    }
    throw new InvalidEkoTransitionError(this.current, target);
  }

  completeActive(): EkoState {
    if (this.current !== 'ACTIVE')
      throw new InvalidEkoTransitionError(this.current, this.returnState);
    this.current = this.returnState;
    return this.current;
  }
}

export interface EkoStateRepository {
  get(userId: string, deviceId: string): Promise<StoredEkoState>;
  set(userId: string, deviceId: string, state: StoredEkoState): Promise<StoredEkoState>;
}

export class InMemoryEkoStateRepository implements EkoStateRepository {
  private readonly states = new Map<string, StoredEkoState>();

  async get(userId: string, deviceId: string): Promise<StoredEkoState> {
    return this.states.get(`${userId}\0${deviceId}`) ?? 'OFF';
  }

  async set(userId: string, deviceId: string, state: StoredEkoState): Promise<StoredEkoState> {
    this.states.set(`${userId}\0${deviceId}`, state);
    return state;
  }
}

export type VadOptions = {
  speechThreshold: number;
  minimumSpeechMs: number;
  silenceTimeoutMs: number;
  maximumSegmentMs: number;
};

export type VadFrame = { level: number; durationMs: number; timestampMs: number };
export type VadEvent =
  | { type: 'speech_start'; timestampMs: number }
  | { type: 'speech_end'; timestampMs: number; durationMs: number; reason: 'silence' | 'maximum' }
  | { type: 'discard'; timestampMs: number; durationMs: number; reason: 'too_short' };

export class EnergyVadSegmenter {
  private speechStartedAt: number | undefined;
  private silenceStartedAt: number | undefined;
  private speechDurationMs = 0;

  constructor(private readonly options: VadOptions) {
    if (options.speechThreshold <= 0 || options.speechThreshold > 1)
      throw new Error('speechThreshold must be in (0, 1]');
    if (options.minimumSpeechMs <= 0 || options.silenceTimeoutMs <= 0)
      throw new Error('VAD durations must be positive');
    if (options.maximumSegmentMs < options.minimumSpeechMs)
      throw new Error('maximumSegmentMs must be at least minimumSpeechMs');
  }

  process(frame: VadFrame): VadEvent[] {
    const events: VadEvent[] = [];
    const speech = frame.level >= this.options.speechThreshold;
    if (this.speechStartedAt === undefined) {
      if (speech) {
        this.speechStartedAt = frame.timestampMs;
        this.speechDurationMs = frame.durationMs;
        events.push({ type: 'speech_start', timestampMs: frame.timestampMs });
      }
      return events;
    }
    const durationMs = frame.timestampMs + frame.durationMs - this.speechStartedAt;
    if (speech) {
      this.speechDurationMs += frame.durationMs;
      this.silenceStartedAt = undefined;
    }
    if (durationMs >= this.options.maximumSegmentMs)
      return [...events, this.finish(frame.timestampMs + frame.durationMs, durationMs, 'maximum')];
    if (speech) return events;
    this.silenceStartedAt ??= frame.timestampMs;
    if (
      frame.timestampMs + frame.durationMs - this.silenceStartedAt <
      this.options.silenceTimeoutMs
    )
      return events;
    return [...events, this.finish(frame.timestampMs + frame.durationMs, durationMs, 'silence')];
  }

  reset(): void {
    this.speechStartedAt = undefined;
    this.silenceStartedAt = undefined;
    this.speechDurationMs = 0;
  }

  private finish(timestampMs: number, durationMs: number, reason: 'silence' | 'maximum'): VadEvent {
    const speechDurationMs = this.speechDurationMs;
    this.reset();
    return speechDurationMs < this.options.minimumSpeechMs
      ? { type: 'discard', timestampMs, durationMs, reason: 'too_short' }
      : { type: 'speech_end', timestampMs, durationMs, reason };
  }
}

export type RingBufferItem<T> = { value: T; durationMs: number };

export class TimedRingBuffer<T> {
  private readonly items: Array<RingBufferItem<T>> = [];
  private totalDurationMs = 0;

  constructor(readonly capacityMs: number) {
    if (!Number.isFinite(capacityMs) || capacityMs <= 0)
      throw new Error('capacityMs must be positive');
  }

  push(value: T, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    this.items.push({ value, durationMs });
    this.totalDurationMs += durationMs;
    while (this.totalDurationMs > this.capacityMs && this.items.length > 1) {
      const removed = this.items.shift();
      if (removed) this.totalDurationMs -= removed.durationMs;
    }
  }

  snapshot(lookbackMs = this.capacityMs): T[] {
    const result: T[] = [];
    let duration = 0;
    for (let index = this.items.length - 1; index >= 0 && duration < lookbackMs; index--) {
      const item = this.items[index];
      if (!item) continue;
      result.unshift(item.value);
      duration += item.durationMs;
    }
    return result;
  }

  clear(): void {
    this.items.length = 0;
    this.totalDurationMs = 0;
  }

  get durationMs(): number {
    return this.totalDurationMs;
  }
}

export type EkoLimits = {
  maxSttMinutesPerHour: number;
  maxSegmentsPerMinute: number;
  maxMemoryExtractionsPerHour: number;
};

export type EkoLimitCode = 'STT_MINUTES_PER_HOUR' | 'SEGMENTS_PER_MINUTE' | 'EXTRACTIONS_PER_HOUR';

export class EkoRateLimiter {
  private readonly segments = new Map<string, Array<{ at: number; durationMs: number }>>();
  private readonly extractions = new Map<string, number[]>();

  constructor(
    private readonly limits: EkoLimits,
    private readonly now: () => number = Date.now,
  ) {}

  admitSegment(userId: string, deviceId: string, durationMs: number): EkoLimitCode | undefined {
    const now = this.now();
    const key = `${userId}\0${deviceId}`;
    const entries = (this.segments.get(key) ?? []).filter((entry) => entry.at > now - 3_600_000);
    if (
      entries.filter((entry) => entry.at > now - 60_000).length >= this.limits.maxSegmentsPerMinute
    )
      return 'SEGMENTS_PER_MINUTE';
    const usedMs = entries.reduce((total, entry) => total + entry.durationMs, 0);
    if (usedMs + durationMs > this.limits.maxSttMinutesPerHour * 60_000)
      return 'STT_MINUTES_PER_HOUR';
    entries.push({ at: now, durationMs });
    this.segments.set(key, entries);
    return undefined;
  }

  admitExtraction(userId: string, deviceId: string): EkoLimitCode | undefined {
    const now = this.now();
    const key = `${userId}\0${deviceId}`;
    const entries = (this.extractions.get(key) ?? []).filter(
      (timestamp) => timestamp > now - 3_600_000,
    );
    if (entries.length >= this.limits.maxMemoryExtractionsPerHour) return 'EXTRACTIONS_PER_HOUR';
    entries.push(now);
    this.extractions.set(key, entries);
    return undefined;
  }
}

export class EkoNotAmbientError extends Error {
  constructor() {
    super('Eko is not in AMBIENT state');
    this.name = 'EkoNotAmbientError';
  }
}

export class EkoRateLimitError extends Error {
  constructor(readonly code: EkoLimitCode) {
    super(`Eko rate limit reached: ${code}`);
    this.name = 'EkoRateLimitError';
  }
}

export type AmbientSegmentResult = {
  segmentId: string;
  transcript?: AmbientTranscript;
  decision: 'DISCARD' | 'KEEP';
  reason: string;
  memory?: LongTermMemory;
  deduplicated: boolean;
};

export class EkoAmbientService {
  constructor(
    private readonly dependencies: {
      states: EkoStateRepository;
      repository: LongTermMemoryRepository;
      stt: SpeechToTextProvider;
      classifier: MemoryClassifier;
      embeddings: EmbeddingProvider;
      router: ModelRouter;
      usage: AIUsageRepository;
      rateLimiter: EkoRateLimiter;
      language: string;
      embeddingModel: string;
      transcriptRetentionMs: number;
      deduplicationThreshold?: number;
      onTelemetryError?: (error: unknown) => void;
      now?: () => Date;
    },
  ) {}

  async processSegment(
    input: IdentityContext &
      ValidatedAudio & {
        durationMs: number;
        sourceTimestamp?: Date;
        sourceContext?: 'unknown' | 'media';
      },
  ): Promise<AmbientSegmentResult> {
    const segmentId = randomUUID();
    if ((await this.dependencies.states.get(input.userId, input.deviceId)) !== 'AMBIENT')
      throw new EkoNotAmbientError();
    const segmentLimit = this.dependencies.rateLimiter.admitSegment(
      input.userId,
      input.deviceId,
      input.durationMs,
    );
    if (segmentLimit) throw new EkoRateLimitError(segmentLimit);
    const now = this.dependencies.now?.() ?? new Date();
    await this.cleanup(now);
    const sttRoute = this.dependencies.router.resolve('STT');
    const transcription = await this.dependencies.stt.transcribe({
      model: sttRoute.model,
      audio: input.audio,
      format: input.format,
      mimeType: input.mimeType,
      language: this.dependencies.language,
    });
    await this.recordUsage(input, transcription.usage, 'STT', 'ambient_stt', segmentId);
    const text = transcription.text.trim();
    if (!text)
      return { segmentId, decision: 'DISCARD', reason: 'empty_transcript', deduplicated: false };
    const sourceTimestamp = input.sourceTimestamp ?? now;
    const transcript = await this.dependencies.repository.createAmbientTranscript({
      userId: input.userId,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      text,
      durationMs: input.durationMs,
      sourceTimestamp,
      expiresAt: new Date(now.getTime() + this.dependencies.transcriptRetentionMs),
      metadata: { sourceContext: input.sourceContext ?? 'unknown', segmentId },
    });
    const extractionLimit = this.dependencies.rateLimiter.admitExtraction(
      input.userId,
      input.deviceId,
    );
    if (extractionLimit) {
      await this.dependencies.repository.completeAmbientTranscript(transcript.id, input.userId, {
        decision: 'DISCARD',
      });
      return {
        segmentId,
        transcript,
        decision: 'DISCARD',
        reason: extractionLimit,
        deduplicated: false,
      };
    }
    const classified = await this.dependencies.classifier.classify({
      transcript: text,
      sourceContext: input.sourceContext ?? 'unknown',
    });
    if (classified.usage)
      await this.recordUsage(input, classified.usage, 'MEMORY', 'memory_classification', segmentId);
    if (classified.classification.decision === 'DISCARD' || !classified.classification.type) {
      const completed = await this.dependencies.repository.completeAmbientTranscript(
        transcript.id,
        input.userId,
        { decision: 'DISCARD' },
      );
      return {
        segmentId,
        transcript: completed ?? transcript,
        decision: 'DISCARD',
        reason: classified.classification.reason,
        deduplicated: false,
      };
    }
    const embedded = await this.dependencies.embeddings.embed({
      model: this.dependencies.embeddingModel,
      text: classified.classification.content,
    });
    await this.recordUsage(input, embedded.usage, 'EMBEDDING', 'memory_embedding', segmentId);
    const similar = (
      await this.dependencies.repository.searchLongTermMemory(
        input.userId,
        embedded.embedding,
        1,
        now,
      )
    )[0];
    const duplicate =
      similar &&
      similar.type === classified.classification.type &&
      similar.similarity >= (this.dependencies.deduplicationThreshold ?? 0.9)
        ? similar
        : undefined;
    const memory = duplicate
      ? await this.dependencies.repository.reinforceLongTermMemory(duplicate.id, input.userId, {
          importance: classified.classification.importance,
          confidence: classified.classification.confidence,
          sourceTimestamp,
        })
      : await this.dependencies.repository.createLongTermMemory({
          userId: input.userId,
          deviceId: input.deviceId,
          type: classified.classification.type,
          content: classified.classification.content,
          importance: classified.classification.importance,
          confidence: classified.classification.confidence,
          source: 'eko',
          sourceTimestamp,
          sourceTranscriptId: transcript.id,
          embedding: embedded.embedding,
          embeddingModel: embedded.usage.model,
          metadata: {
            speakerIdentity: 'unknown',
            sourceContext: input.sourceContext ?? 'unknown',
            classificationReason: classified.classification.reason,
          },
        });
    if (!memory) throw new Error('Could not persist or reinforce Eko memory');
    const completed = await this.dependencies.repository.completeAmbientTranscript(
      transcript.id,
      input.userId,
      { decision: 'KEEP', memoryId: memory.id },
    );
    return {
      segmentId,
      transcript: completed ?? transcript,
      decision: 'KEEP',
      reason: classified.classification.reason,
      memory,
      deduplicated: Boolean(duplicate),
    };
  }

  private async cleanup(now: Date): Promise<void> {
    await Promise.all([
      this.dependencies.repository.deleteExpiredTranscripts(now),
      this.dependencies.repository.deleteExpiredLongTermMemories(now),
    ]);
  }

  private async recordUsage(
    identity: IdentityContext,
    usage: {
      provider: string;
      model: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      inputUnits?: string;
      outputUnits?: string;
      unit?: string;
      latencyMs: number;
      cost?: string;
    },
    capability: NewAIUsageRecord['capability'],
    operation: NonNullable<NewAIUsageRecord['operation']>,
    requestId: string,
  ): Promise<void> {
    const record: NewAIUsageRecord = {
      requestId,
      userId: identity.userId,
      deviceId: identity.deviceId,
      sessionId: identity.sessionId,
      provider: usage.provider,
      model: usage.model,
      capability,
      operation,
      ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
      ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
      ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
      ...(usage.inputUnits !== undefined ? { inputUnits: usage.inputUnits } : {}),
      ...(usage.outputUnits !== undefined ? { outputUnits: usage.outputUnits } : {}),
      ...(usage.unit !== undefined ? { unit: usage.unit } : {}),
      latencyMs: usage.latencyMs,
      ...(usage.cost !== undefined ? { estimatedCost: usage.cost } : {}),
    };
    try {
      await this.dependencies.usage.record(record);
    } catch (error) {
      try {
        this.dependencies.onTelemetryError?.(error);
      } catch {
        // Telemetry remains best-effort.
      }
    }
  }
}
