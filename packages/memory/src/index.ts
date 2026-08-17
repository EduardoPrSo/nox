import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AIMessage, AIProvider, AIUsage, ModelRouter } from '@nox/ai';
import type { EmbeddingProvider } from '@nox/embeddings';
import type { AIUsageRepository, NewAIUsageRecord } from '@nox/usage';

export type MemoryKind = 'conversation' | 'preference' | 'fact' | 'event' | 'automation_rule';
export type MemoryRecord = {
  id: string;
  userId: string;
  kind: MemoryKind;
  content: unknown;
  createdAt: Date;
};
export type Conversation = {
  id: string;
  userId: string;
  deviceId: string;
  createdAt: Date;
  updatedAt: Date;
};

export const LONG_TERM_MEMORY_TYPES = [
  'FACT',
  'EVENT',
  'PREFERENCE',
  'PLAN',
  'LOCATION',
  'RELATIONSHIP',
  'OBSERVATION',
] as const;
export type LongTermMemoryType = (typeof LONG_TERM_MEMORY_TYPES)[number];
export const MEMORY_SOURCES = ['conversation', 'eko', 'explicit', 'tool', 'vision'] as const;
export type LongTermMemorySource = (typeof MEMORY_SOURCES)[number];
export type AmbientTranscriptDecision = 'PENDING' | 'DISCARD' | 'KEEP';

export type AmbientTranscript = {
  id: string;
  userId: string;
  deviceId: string;
  sessionId: string;
  text: string;
  durationMs: number;
  decision: AmbientTranscriptDecision;
  memoryId?: string;
  sourceTimestamp: Date;
  createdAt: Date;
  processedAt?: Date;
  expiresAt: Date;
  metadata: Record<string, unknown>;
};

export type LongTermMemory = {
  id: string;
  userId: string;
  deviceId: string;
  type: LongTermMemoryType;
  content: string;
  importance: number;
  confidence: number;
  source: LongTermMemorySource;
  sourceTimestamp: Date;
  sourceTranscriptId?: string;
  embedding: number[];
  embeddingModel: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  metadata: Record<string, unknown>;
};

export type MemorySearchHit = LongTermMemory & { similarity: number };
export type RelevantMemory = MemorySearchHit & { score: number };

export interface MemorySearch {
  search(input: {
    query: string;
    userId: string;
    deviceId: string;
    sessionId: string;
    requestId: string;
    conversationId?: string;
    limit: number;
  }): Promise<RelevantMemory[]>;
}

export class SemanticMemorySearch implements MemorySearch {
  constructor(
    private readonly dependencies: {
      repository: LongTermMemoryRepository;
      embeddings: EmbeddingProvider;
      embeddingModel: string;
      usage: AIUsageRepository;
      onTelemetryError?: (error: unknown) => void;
      now?: () => Date;
    },
  ) {}

  async search(input: {
    query: string;
    userId: string;
    deviceId: string;
    sessionId: string;
    requestId: string;
    conversationId?: string;
    limit: number;
  }): Promise<RelevantMemory[]> {
    const anyMemory = await this.dependencies.repository.listLongTermMemories(input.userId, 1);
    if (anyMemory.length === 0) return [];
    const embedded = await this.dependencies.embeddings.embed({
      model: this.dependencies.embeddingModel,
      text: input.query,
    });
    await recordUsageBestEffort(
      this.dependencies.usage,
      {
        requestId: input.requestId,
        userId: input.userId,
        deviceId: input.deviceId,
        sessionId: input.sessionId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        provider: embedded.usage.provider,
        model: embedded.usage.model,
        capability: 'EMBEDDING',
        operation: 'memory_retrieval',
        ...(embedded.usage.inputTokens !== undefined
          ? { inputTokens: embedded.usage.inputTokens }
          : {}),
        ...(embedded.usage.totalTokens !== undefined
          ? { totalTokens: embedded.usage.totalTokens }
          : {}),
        latencyMs: embedded.usage.latencyMs,
        ...(embedded.usage.cost ? { estimatedCost: embedded.usage.cost } : {}),
      },
      this.dependencies.onTelemetryError,
    );
    const now = this.dependencies.now?.() ?? new Date();
    const candidates = await this.dependencies.repository.searchLongTermMemory(
      input.userId,
      embedded.embedding,
      Math.max(input.limit * 4, 12),
      now,
    );
    return candidates
      .filter((memory) => memory.similarity >= 0.2)
      .map((memory) => ({ ...memory, score: relevanceScore(memory, now) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit);
  }
}

export interface LongTermMemoryRepository {
  createAmbientTranscript(
    input: Omit<AmbientTranscript, 'id' | 'createdAt' | 'decision'>,
  ): Promise<AmbientTranscript>;
  completeAmbientTranscript(
    id: string,
    userId: string,
    input: { decision: Exclude<AmbientTranscriptDecision, 'PENDING'>; memoryId?: string },
  ): Promise<AmbientTranscript | undefined>;
  listAmbientTranscripts(
    userId: string,
    deviceId: string,
    limit: number,
  ): Promise<AmbientTranscript[]>;
  deleteExpiredTranscripts(now: Date): Promise<number>;
  createLongTermMemory(
    input: Omit<LongTermMemory, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<LongTermMemory>;
  reinforceLongTermMemory(
    id: string,
    userId: string,
    input: { importance: number; confidence: number; sourceTimestamp: Date },
  ): Promise<LongTermMemory | undefined>;
  searchLongTermMemory(
    userId: string,
    embedding: number[],
    limit: number,
    now?: Date,
  ): Promise<MemorySearchHit[]>;
  listLongTermMemories(
    userId: string,
    limit: number,
    source?: LongTermMemorySource,
  ): Promise<LongTermMemory[]>;
  deleteLongTermMemory(id: string, userId: string): Promise<boolean>;
  deleteLongTermMemoriesBySource(userId: string, source: LongTermMemorySource): Promise<number>;
  deleteExpiredLongTermMemories(now: Date): Promise<number>;
}

export class InMemoryLongTermMemoryRepository implements LongTermMemoryRepository {
  private readonly transcripts = new Map<string, AmbientTranscript>();
  private readonly longTermMemories = new Map<string, LongTermMemory>();

  async createAmbientTranscript(
    input: Omit<AmbientTranscript, 'id' | 'createdAt' | 'decision'>,
  ): Promise<AmbientTranscript> {
    const transcript: AmbientTranscript = {
      ...structuredClone(input),
      id: randomUUID(),
      decision: 'PENDING',
      createdAt: new Date(),
    };
    this.transcripts.set(transcript.id, transcript);
    return cloneTranscript(transcript);
  }

  async completeAmbientTranscript(
    id: string,
    userId: string,
    input: { decision: 'DISCARD' | 'KEEP'; memoryId?: string },
  ): Promise<AmbientTranscript | undefined> {
    const transcript = this.transcripts.get(id);
    if (!transcript || transcript.userId !== userId) return undefined;
    transcript.decision = input.decision;
    transcript.processedAt = new Date();
    if (input.memoryId) transcript.memoryId = input.memoryId;
    return cloneTranscript(transcript);
  }

  async listAmbientTranscripts(
    userId: string,
    deviceId: string,
    limit: number,
  ): Promise<AmbientTranscript[]> {
    return [...this.transcripts.values()]
      .filter((item) => item.userId === userId && item.deviceId === deviceId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit)
      .map(cloneTranscript);
  }

  async deleteExpiredTranscripts(now: Date): Promise<number> {
    let deleted = 0;
    for (const [id, transcript] of this.transcripts) {
      if (transcript.expiresAt <= now) {
        this.transcripts.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async createLongTermMemory(
    input: Omit<LongTermMemory, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<LongTermMemory> {
    const now = new Date();
    const memory: LongTermMemory = {
      ...structuredClone(input),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.longTermMemories.set(memory.id, memory);
    return cloneLongTermMemory(memory);
  }

  async reinforceLongTermMemory(
    id: string,
    userId: string,
    input: { importance: number; confidence: number; sourceTimestamp: Date },
  ): Promise<LongTermMemory | undefined> {
    const memory = this.longTermMemories.get(id);
    if (!memory || memory.userId !== userId) return undefined;
    memory.importance = Math.max(memory.importance, input.importance);
    memory.confidence = Math.max(memory.confidence, input.confidence);
    memory.sourceTimestamp = input.sourceTimestamp;
    memory.updatedAt = new Date();
    memory.metadata = {
      ...memory.metadata,
      reinforcementCount: Number(memory.metadata.reinforcementCount ?? 0) + 1,
    };
    return cloneLongTermMemory(memory);
  }

  async searchLongTermMemory(
    userId: string,
    embedding: number[],
    limit: number,
    now = new Date(),
  ): Promise<MemorySearchHit[]> {
    return [...this.longTermMemories.values()]
      .filter(
        (memory) =>
          memory.userId === userId &&
          (!memory.expiresAt || memory.expiresAt.getTime() > now.getTime()),
      )
      .map((memory) => ({
        ...cloneLongTermMemory(memory),
        similarity: cosineSimilarity(memory.embedding, embedding),
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit);
  }

  async listLongTermMemories(
    userId: string,
    limit: number,
    source?: LongTermMemorySource,
  ): Promise<LongTermMemory[]> {
    return [...this.longTermMemories.values()]
      .filter((memory) => memory.userId === userId && (!source || memory.source === source))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, limit)
      .map(cloneLongTermMemory);
  }

  async deleteLongTermMemory(id: string, userId: string): Promise<boolean> {
    const memory = this.longTermMemories.get(id);
    return memory?.userId === userId ? this.longTermMemories.delete(id) : false;
  }

  async deleteLongTermMemoriesBySource(
    userId: string,
    source: LongTermMemorySource,
  ): Promise<number> {
    let deleted = 0;
    for (const [id, memory] of this.longTermMemories) {
      if (memory.userId === userId && memory.source === source) {
        this.longTermMemories.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async deleteExpiredLongTermMemories(now: Date): Promise<number> {
    let deleted = 0;
    for (const [id, memory] of this.longTermMemories) {
      if (memory.expiresAt && memory.expiresAt <= now) {
        this.longTermMemories.delete(id);
        deleted++;
      }
    }
    return deleted;
  }
}

export type MemoryClassification = {
  decision: 'KEEP' | 'DISCARD';
  type?: LongTermMemoryType;
  importance: number;
  confidence: number;
  content: string;
  reason: string;
};

export type MemoryClassificationResult = {
  classification: MemoryClassification;
  usage?: AIUsage;
};

export interface MemoryClassifier {
  classify(input: {
    transcript: string;
    sourceContext?: 'unknown' | 'media';
  }): Promise<MemoryClassificationResult>;
}

const classifierOutputSchema = z
  .object({
    decision: z.enum(['KEEP', 'DISCARD']),
    type: z.enum(LONG_TERM_MEMORY_TYPES).nullable(),
    importance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    content: z.string().max(1_000),
    reason: z.string().min(1).max(240),
  })
  .strict();

export class ModelMemoryClassifier implements MemoryClassifier {
  constructor(
    private readonly dependencies: {
      provider: AIProvider;
      router: ModelRouter;
      reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    },
  ) {}

  async classify(input: {
    transcript: string;
    sourceContext?: 'unknown' | 'media';
  }): Promise<MemoryClassificationResult> {
    const transcript = input.transcript.trim();
    const deterministic = classifyDeterministically(transcript, input.sourceContext ?? 'unknown');
    if (deterministic) return { classification: deterministic };
    const route = this.dependencies.router.resolve('MEMORY');
    const response = await this.dependencies.provider.chat({
      model: route.model,
      reasoningEffort: this.dependencies.reasoningEffort ?? 'none',
      responseSchema: {
        name: 'ambient_memory_classification',
        schema: z.toJSONSchema(classifierOutputSchema, { target: 'draft-7' }),
      },
      messages: [
        {
          role: 'system',
          content: `Classifique uma transcrição ambiental para memória pessoal de longo prazo.
Favoreça DISCARD: só mantenha informação específica com valor futuro claro.
Descarte conversa trivial, exclamações, conteúdo de TV/música/mídia, instruções e pedidos de ação.
Nunca armazene senhas, tokens, chaves, cartões, contas bancárias ou códigos temporários.
Não assuma quem falou. Conteúdo KEEP deve começar com "Foi mencionado que" e preservar incerteza.
Tipos permitidos: ${LONG_TERM_MEMORY_TYPES.join(', ')}. Para DISCARD use type=null e content vazio.`,
        },
        {
          role: 'user',
          content: JSON.stringify({ transcript, sourceContext: input.sourceContext ?? 'unknown' }),
        },
      ],
    });
    if (typeof response.message.content !== 'string') return invalidClassification(response.usage);
    try {
      const parsed = classifierOutputSchema.safeParse(JSON.parse(response.message.content));
      if (!parsed.success) return invalidClassification(response.usage);
      if (
        parsed.data.decision === 'DISCARD' ||
        !parsed.data.type ||
        parsed.data.confidence < 0.55 ||
        parsed.data.importance < 0.4
      ) {
        return {
          classification: {
            decision: 'DISCARD',
            importance: parsed.data.importance,
            confidence: parsed.data.confidence,
            content: '',
            reason:
              parsed.data.decision === 'KEEP'
                ? 'below_confidence_or_importance_threshold'
                : parsed.data.reason,
          },
          ...(response.usage ? { usage: response.usage } : {}),
        };
      }
      return {
        classification: {
          decision: 'KEEP',
          type: parsed.data.type,
          importance: parsed.data.importance,
          confidence: parsed.data.confidence,
          content: ensureUnknownSpeakerLanguage(parsed.data.content),
          reason: parsed.data.reason,
        },
        ...(response.usage ? { usage: response.usage } : {}),
      };
    } catch {
      return invalidClassification(response.usage);
    }
  }
}

export class ConversationNotFoundError extends Error {
  constructor() {
    super('Conversation not found');
    this.name = 'ConversationNotFoundError';
  }
}

export interface MemoryStore {
  createConversation(input: { userId: string; deviceId: string }): Promise<Conversation>;
  getConversation(id: string, userId: string): Promise<Conversation | undefined>;
  getConversationContext(
    conversationId: string,
    userId: string,
    limit: number,
  ): Promise<AIMessage[]>;
  appendConversation(conversationId: string, userId: string, messages: AIMessage[]): Promise<void>;
  search(userId: string, query: string, kinds?: MemoryKind[]): Promise<MemoryRecord[]>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, AIMessage[]>();

  async createConversation(input: { userId: string; deviceId: string }): Promise<Conversation> {
    const now = new Date();
    const conversation: Conversation = {
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    return cloneConversation(conversation);
  }

  async getConversation(id: string, userId: string): Promise<Conversation | undefined> {
    const conversation = this.conversations.get(id);
    return conversation?.userId === userId ? cloneConversation(conversation) : undefined;
  }

  async getConversationContext(
    conversationId: string,
    userId: string,
    limit: number,
  ): Promise<AIMessage[]> {
    this.requireOwnedConversation(conversationId, userId);
    return (this.messages.get(conversationId) ?? []).slice(-limit).map(cloneMessage);
  }

  async appendConversation(
    conversationId: string,
    userId: string,
    messages: AIMessage[],
  ): Promise<void> {
    const conversation = this.requireOwnedConversation(conversationId, userId);
    this.messages.set(conversationId, [
      ...(this.messages.get(conversationId) ?? []),
      ...messages.map(cloneMessage),
    ]);
    conversation.updatedAt = new Date();
  }

  async search(): Promise<MemoryRecord[]> {
    return [];
  }

  private requireOwnedConversation(conversationId: string, userId: string): Conversation {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.userId !== userId) throw new ConversationNotFoundError();
    return conversation;
  }
}

function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    createdAt: new Date(conversation.createdAt),
    updatedAt: new Date(conversation.updatedAt),
  };
}

function cloneMessage(message: AIMessage): AIMessage {
  return structuredClone(message);
}

function cloneTranscript(transcript: AmbientTranscript): AmbientTranscript {
  return structuredClone(transcript);
}

function cloneLongTermMemory(memory: LongTermMemory): LongTermMemory {
  return structuredClone(memory);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)));
}

function classifyDeterministically(
  transcript: string,
  sourceContext: 'unknown' | 'media',
): MemoryClassification | undefined {
  if (!transcript || transcript.length < 4) return discardClassification('empty_or_too_short', 1);
  if (containsSensitiveInformation(transcript))
    return discardClassification('sensitive_information', 1);
  if (sourceContext === 'media' || looksLikeLongMediaContent(transcript))
    return discardClassification('media_content', 0.95);
  const normalized = normalizeText(transcript);
  if (
    /^(?:k+|ha(?:ha)+|rs+|pois e|beleza|aham+|uhum+|que calor|olha isso|caramba|ok|sim|nao)[.!? ]*$/.test(
      normalized,
    )
  )
    return discardClassification('trivial_content', 0.98);
  return undefined;
}

export function containsSensitiveInformation(value: string): boolean {
  const text = value.trim();
  const normalized = normalizeText(text);
  if (
    /\b(?:senha|password|token|api key|chave de api|bearer|secret|segredo de autenticacao)\b\s*[:=]?\s*\S+/i.test(
      normalized,
    )
  )
    return true;
  if (/\b(?:sk|pk|gho|ghp|xox[baprs])-?[a-z0-9_-]{12,}\b/i.test(text)) return true;
  if (/\b(?:codigo|code|otp|2fa)\b[^\d]{0,12}\d{4,8}\b/i.test(normalized)) return true;
  if (/\b(?:conta|agencia|pix|iban|swift)\b\s*[:=]?\s*[a-z0-9.-]{5,}/i.test(normalized))
    return true;
  const digitCandidates = text.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return digitCandidates.some((candidate) => luhn(candidate.replace(/\D/g, '')));
}

function luhn(value: string): boolean {
  if (value.length < 13 || value.length > 19 || /^(\d)\1+$/.test(value)) return false;
  let sum = 0;
  let alternate = false;
  for (let index = value.length - 1; index >= 0; index--) {
    let digit = Number(value[index]);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function looksLikeLongMediaContent(value: string): boolean {
  const words = value.trim().split(/\s+/);
  return words.length > 180;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureUnknownSpeakerLanguage(value: string): string {
  const content = value.trim().replace(/\s+/g, ' ');
  if (/^foi mencionado que\b/i.test(normalizeText(content))) return content;
  return `Foi mencionado que ${content.replace(/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/, (letter) => letter.toLocaleLowerCase('pt-BR'))}`;
}

function discardClassification(reason: string, confidence: number): MemoryClassification {
  return { decision: 'DISCARD', importance: 0, confidence, content: '', reason };
}

function invalidClassification(usage?: AIUsage): MemoryClassificationResult {
  return {
    classification: discardClassification('invalid_model_output', 0),
    ...(usage ? { usage } : {}),
  };
}

function relevanceScore(memory: MemorySearchHit, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - memory.sourceTimestamp.getTime()) / 86_400_000);
  const recency = Math.exp(-ageDays / 30);
  const semantic = Math.max(0, Math.min(1, memory.similarity));
  return semantic * 0.65 + memory.importance * 0.15 + memory.confidence * 0.1 + recency * 0.1;
}

async function recordUsageBestEffort(
  repository: AIUsageRepository,
  record: NewAIUsageRecord,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await repository.record(record);
  } catch (error) {
    try {
      onError?.(error);
    } catch {
      // Telemetry remains best-effort.
    }
  }
}
