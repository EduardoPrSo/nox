import { fileURLToPath } from 'node:url';
import { and, cosineDistance, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import type { AIMessage, MessageContent, ModelCapability, ToolCall } from '@nox/ai';
import type { AuditRepository } from '@nox/audit';
import { sanitize } from '@nox/audit';
import type { ConfirmationRepository, PendingConfirmation } from '@nox/confirmations';
import { hashArguments } from '@nox/confirmations';
import { ConversationNotFoundError } from '@nox/memory';
import type { AIUsageRepository, NewAIUsageRecord } from '@nox/usage';
import type { EkoStateRepository, StoredEkoState } from '@nox/eko';
import type {
  AmbientTranscript,
  Conversation,
  LongTermMemory,
  LongTermMemoryRepository,
  LongTermMemorySource,
  MemoryRecord,
  MemorySearchHit,
  MemoryStore,
} from '@nox/memory';

export const confirmationStatus = pgEnum('confirmation_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
]);
export const conversationRole = pgEnum('conversation_role', [
  'system',
  'user',
  'assistant',
  'tool',
]);
export const ekoStoredState = pgEnum('eko_stored_state', ['OFF', 'AMBIENT']);
export const ambientTranscriptDecision = pgEnum('ambient_transcript_decision', [
  'PENDING',
  'DISCARD',
  'KEEP',
]);
export const longTermMemoryType = pgEnum('long_term_memory_type', [
  'FACT',
  'EVENT',
  'PREFERENCE',
  'PLAN',
  'LOCATION',
  'RELATIONSHIP',
  'OBSERVATION',
]);
export const longTermMemorySource = pgEnum('long_term_memory_source', [
  'conversation',
  'eko',
  'explicit',
  'tool',
  'vision',
]);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull(),
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    data: jsonb('data').notNull(),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('audit_logs_user_created_idx').on(table.userId, table.createdAt)],
);
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('conversations_user_updated_idx').on(table.userId, table.updatedAt)],
);
export const conversationMessages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sequence: serial('sequence').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: conversationRole('role').notNull(),
    content: jsonb('content').$type<MessageContent>().notNull(),
    toolCallId: text('tool_call_id'),
    toolCalls: jsonb('tool_calls').$type<ToolCall[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('messages_conversation_sequence_idx').on(table.conversationId, table.sequence)],
);
export const confirmations = pgTable('confirmations', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull(),
  userId: text('user_id').notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id, {
    onDelete: 'set null',
  }),
  toolCallId: text('tool_call_id').notNull(),
  toolName: text('tool_name').notNull(),
  arguments: jsonb('arguments').notNull(),
  argumentsHash: text('arguments_hash').notNull(),
  description: text('description').notNull(),
  status: confirmationStatus('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull(),
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    capability: text('capability').$type<ModelCapability>().notNull(),
    operation: text('operation'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    cachedTokens: integer('cached_tokens'),
    inputUnits: numeric('input_units', { precision: 24, scale: 6 }),
    outputUnits: numeric('output_units', { precision: 24, scale: 6 }),
    unit: text('unit'),
    latencyMs: integer('latency_ms'),
    estimatedCost: numeric('estimated_cost', { precision: 24, scale: 12 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ai_usage_user_created_idx').on(table.userId, table.createdAt),
    index('ai_usage_model_created_idx').on(table.model, table.createdAt),
    index('ai_usage_capability_created_idx').on(table.capability, table.createdAt),
  ],
);

export const ekoDeviceStates = pgTable(
  'eko_device_states',
  {
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    state: ekoStoredState('state').default('OFF').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.deviceId] })],
);

export const ambientTranscripts = pgTable(
  'ambient_transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    text: text('text').notNull(),
    durationMs: integer('duration_ms').notNull(),
    decision: ambientTranscriptDecision('decision').default('PENDING').notNull(),
    memoryId: uuid('memory_id'),
    sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  },
  (table) => [
    index('ambient_transcripts_owner_created_idx').on(
      table.userId,
      table.deviceId,
      table.createdAt,
    ),
    index('ambient_transcripts_expires_idx').on(table.expiresAt),
  ],
);

export const longTermMemories = pgTable(
  'long_term_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    type: longTermMemoryType('type').notNull(),
    content: text('content').notNull(),
    importance: numeric('importance', { precision: 4, scale: 3 }).notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    source: longTermMemorySource('source').notNull(),
    sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }).notNull(),
    sourceTranscriptId: uuid('source_transcript_id'),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    embeddingModel: text('embedding_model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  },
  (table) => [
    index('long_term_memories_owner_updated_idx').on(table.userId, table.updatedAt),
    index('long_term_memories_owner_source_idx').on(table.userId, table.source),
    index('long_term_memories_expires_idx').on(table.expiresAt),
  ],
);

type Database = ReturnType<typeof drizzle>;
type NewConfirmation = Parameters<ConfirmationRepository['create']>[0];

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly db: Database) {}
  async log(event: Parameters<AuditRepository['log']>[0]): Promise<void> {
    await this.db.insert(auditLogs).values({
      requestId: event.requestId,
      userId: event.userId,
      type: event.type,
      data: sanitize(event.data),
      durationMs: event.durationMs,
    });
  }
}

export class DrizzleConfirmationRepository implements ConfirmationRepository {
  constructor(
    private readonly db: Database,
    private readonly ttlMs = 300_000,
  ) {}
  async create(input: NewConfirmation): Promise<PendingConfirmation> {
    const rows = await this.db
      .insert(confirmations)
      .values({
        ...input,
        argumentsHash: hashArguments(input.arguments),
        expiresAt: new Date(Date.now() + this.ttlMs),
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Could not create confirmation');
    return mapConfirmation(row);
  }
  async resolve(
    id: string,
    userId: string,
    approve: boolean,
  ): Promise<PendingConfirmation | undefined> {
    const rows = await this.db
      .update(confirmations)
      .set({ status: approve ? 'approved' : 'rejected' })
      .where(
        and(
          eq(confirmations.id, id),
          eq(confirmations.userId, userId),
          eq(confirmations.status, 'pending'),
        ),
      )
      .returning();
    const row = rows[0];
    if (!row) return undefined;
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.db
        .update(confirmations)
        .set({ status: 'expired' })
        .where(eq(confirmations.id, id));
      return { ...mapConfirmation(row), status: 'expired' };
    }
    return mapConfirmation(row);
  }
}

export class DrizzleMemoryStore implements MemoryStore {
  constructor(private readonly db: Database) {}

  async createConversation(input: { userId: string; deviceId: string }): Promise<Conversation> {
    const rows = await this.db.insert(conversations).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('Could not create conversation');
    return mapConversation(row);
  }

  async getConversation(id: string, userId: string): Promise<Conversation | undefined> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .limit(1);
    const row = rows[0];
    return row ? mapConversation(row) : undefined;
  }

  async getConversationContext(
    conversationId: string,
    userId: string,
    limit: number,
  ): Promise<AIMessage[]> {
    const owned = await this.getConversation(conversationId, userId);
    if (!owned) throw new ConversationNotFoundError();
    const rows = await this.db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(desc(conversationMessages.sequence))
      .limit(limit);
    return rows.reverse().map(mapMessage);
  }

  async appendConversation(
    conversationId: string,
    userId: string,
    messages: AIMessage[],
  ): Promise<void> {
    const owned = await this.getConversation(conversationId, userId);
    if (!owned) throw new ConversationNotFoundError();
    if (messages.length === 0) return;
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMessages).values(
        messages.map((message) => ({
          conversationId,
          role: message.role,
          content: message.content,
          toolCallId: message.toolCallId,
          toolCalls: message.toolCalls,
        })),
      );
      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
    });
  }

  async search(): Promise<MemoryRecord[]> {
    return [];
  }
}

export class DrizzleEkoStateRepository implements EkoStateRepository {
  constructor(private readonly db: Database) {}

  async get(userId: string, deviceId: string): Promise<StoredEkoState> {
    const rows = await this.db
      .select({ state: ekoDeviceStates.state })
      .from(ekoDeviceStates)
      .where(and(eq(ekoDeviceStates.userId, userId), eq(ekoDeviceStates.deviceId, deviceId)))
      .limit(1);
    return rows[0]?.state ?? 'OFF';
  }

  async set(userId: string, deviceId: string, state: StoredEkoState): Promise<StoredEkoState> {
    const rows = await this.db
      .insert(ekoDeviceStates)
      .values({ userId, deviceId, state, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [ekoDeviceStates.userId, ekoDeviceStates.deviceId],
        set: { state, updatedAt: new Date() },
      })
      .returning({ state: ekoDeviceStates.state });
    return rows[0]?.state ?? state;
  }
}

export class DrizzleLongTermMemoryRepository implements LongTermMemoryRepository {
  constructor(private readonly db: Database) {}

  async createAmbientTranscript(
    input: Omit<AmbientTranscript, 'id' | 'createdAt' | 'decision'>,
  ): Promise<AmbientTranscript> {
    const rows = await this.db.insert(ambientTranscripts).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('Could not create ambient transcript');
    return mapAmbientTranscript(row);
  }

  async completeAmbientTranscript(
    id: string,
    userId: string,
    input: { decision: 'DISCARD' | 'KEEP'; memoryId?: string },
  ): Promise<AmbientTranscript | undefined> {
    const rows = await this.db
      .update(ambientTranscripts)
      .set({
        decision: input.decision,
        processedAt: new Date(),
        ...(input.memoryId ? { memoryId: input.memoryId } : {}),
      })
      .where(and(eq(ambientTranscripts.id, id), eq(ambientTranscripts.userId, userId)))
      .returning();
    return rows[0] ? mapAmbientTranscript(rows[0]) : undefined;
  }

  async listAmbientTranscripts(
    userId: string,
    deviceId: string,
    limit: number,
  ): Promise<AmbientTranscript[]> {
    const rows = await this.db
      .select()
      .from(ambientTranscripts)
      .where(and(eq(ambientTranscripts.userId, userId), eq(ambientTranscripts.deviceId, deviceId)))
      .orderBy(desc(ambientTranscripts.createdAt))
      .limit(limit);
    return rows.map(mapAmbientTranscript);
  }

  async deleteExpiredTranscripts(now: Date): Promise<number> {
    const rows = await this.db
      .delete(ambientTranscripts)
      .where(sql`${ambientTranscripts.expiresAt} <= ${now}`)
      .returning({ id: ambientTranscripts.id });
    return rows.length;
  }

  async createLongTermMemory(
    input: Omit<LongTermMemory, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<LongTermMemory> {
    const rows = await this.db
      .insert(longTermMemories)
      .values({
        ...input,
        importance: String(input.importance),
        confidence: String(input.confidence),
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Could not create long-term memory');
    return mapLongTermMemory(row);
  }

  async reinforceLongTermMemory(
    id: string,
    userId: string,
    input: { importance: number; confidence: number; sourceTimestamp: Date },
  ): Promise<LongTermMemory | undefined> {
    const ownedRows = await this.db
      .select()
      .from(longTermMemories)
      .where(and(eq(longTermMemories.id, id), eq(longTermMemories.userId, userId)))
      .limit(1);
    const owned = ownedRows[0];
    if (!owned) return undefined;
    const rows = await this.db
      .update(longTermMemories)
      .set({
        importance: String(Math.max(Number(owned.importance), input.importance)),
        confidence: String(Math.max(Number(owned.confidence), input.confidence)),
        sourceTimestamp: input.sourceTimestamp,
        updatedAt: new Date(),
        metadata: {
          ...owned.metadata,
          reinforcementCount: Number(owned.metadata.reinforcementCount ?? 0) + 1,
        },
      })
      .where(and(eq(longTermMemories.id, id), eq(longTermMemories.userId, userId)))
      .returning();
    return rows[0] ? mapLongTermMemory(rows[0]) : undefined;
  }

  async searchLongTermMemory(
    userId: string,
    embedding: number[],
    limit: number,
    now = new Date(),
  ): Promise<MemorySearchHit[]> {
    const similarity = sql<number>`1 - (${cosineDistance(longTermMemories.embedding, embedding)})`;
    const rows = await this.db
      .select({ memory: longTermMemories, similarity })
      .from(longTermMemories)
      .where(
        and(
          eq(longTermMemories.userId, userId),
          or(isNull(longTermMemories.expiresAt), gt(longTermMemories.expiresAt, now)),
        ),
      )
      .orderBy(desc(similarity))
      .limit(limit);
    return rows.map((row) => ({
      ...mapLongTermMemory(row.memory),
      similarity: Number(row.similarity),
    }));
  }

  async listLongTermMemories(
    userId: string,
    limit: number,
    source?: LongTermMemorySource,
  ): Promise<LongTermMemory[]> {
    const condition = source
      ? and(eq(longTermMemories.userId, userId), eq(longTermMemories.source, source))
      : eq(longTermMemories.userId, userId);
    const rows = await this.db
      .select()
      .from(longTermMemories)
      .where(condition)
      .orderBy(desc(longTermMemories.updatedAt))
      .limit(limit);
    return rows.map(mapLongTermMemory);
  }

  async deleteLongTermMemory(id: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(longTermMemories)
      .where(and(eq(longTermMemories.id, id), eq(longTermMemories.userId, userId)))
      .returning({ id: longTermMemories.id });
    return rows.length > 0;
  }

  async deleteLongTermMemoriesBySource(
    userId: string,
    source: LongTermMemorySource,
  ): Promise<number> {
    const rows = await this.db
      .delete(longTermMemories)
      .where(and(eq(longTermMemories.userId, userId), eq(longTermMemories.source, source)))
      .returning({ id: longTermMemories.id });
    return rows.length;
  }

  async deleteExpiredLongTermMemories(now: Date): Promise<number> {
    const rows = await this.db
      .delete(longTermMemories)
      .where(
        sql`${longTermMemories.expiresAt} IS NOT NULL AND ${longTermMemories.expiresAt} <= ${now}`,
      )
      .returning({ id: longTermMemories.id });
    return rows.length;
  }
}

export class DrizzleAIUsageRepository implements AIUsageRepository {
  constructor(private readonly db: Database) {}

  async record(input: NewAIUsageRecord): Promise<void> {
    await this.db.insert(aiUsage).values({
      requestId: input.requestId,
      userId: input.userId,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      provider: input.provider,
      model: input.model,
      capability: input.capability,
      operation: input.operation,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.totalTokens,
      cachedTokens: input.cachedTokens,
      inputUnits: input.inputUnits,
      outputUnits: input.outputUnits,
      unit: input.unit,
      latencyMs: input.latencyMs,
      estimatedCost: input.estimatedCost,
    });
  }
}

export function createPostgresRepositories(databaseUrl: string, confirmationTtlMs: number) {
  const client = postgres(databaseUrl, { prepare: false, max: 10 });
  const db = drizzle(client);
  return {
    audit: new DrizzleAuditRepository(db),
    confirmations: new DrizzleConfirmationRepository(db, confirmationTtlMs),
    memory: new DrizzleMemoryStore(db),
    ekoStates: new DrizzleEkoStateRepository(db),
    longTermMemory: new DrizzleLongTermMemoryRepository(db),
    usage: new DrizzleAIUsageRepository(db),
    close: async () => client.end(),
  };
}

export async function migratePostgres(
  databaseUrl: string,
  migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url)),
): Promise<void> {
  const client = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

function mapConfirmation(row: typeof confirmations.$inferSelect): PendingConfirmation {
  return {
    id: row.id,
    userId: row.userId,
    requestId: row.requestId,
    ...(row.conversationId ? { conversationId: row.conversationId } : {}),
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    arguments: row.arguments,
    argumentsHash: row.argumentsHash,
    description: row.description,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status: row.status,
  };
}

function mapConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMessage(row: typeof conversationMessages.$inferSelect): AIMessage {
  return {
    role: row.role,
    content: row.content,
    ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
    ...(row.toolCalls ? { toolCalls: row.toolCalls } : {}),
  };
}

function mapAmbientTranscript(row: typeof ambientTranscripts.$inferSelect): AmbientTranscript {
  return {
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    sessionId: row.sessionId,
    text: row.text,
    durationMs: row.durationMs,
    decision: row.decision,
    ...(row.memoryId ? { memoryId: row.memoryId } : {}),
    sourceTimestamp: row.sourceTimestamp,
    createdAt: row.createdAt,
    ...(row.processedAt ? { processedAt: row.processedAt } : {}),
    expiresAt: row.expiresAt,
    metadata: row.metadata,
  };
}

function mapLongTermMemory(row: typeof longTermMemories.$inferSelect): LongTermMemory {
  return {
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    type: row.type,
    content: row.content,
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    source: row.source,
    sourceTimestamp: row.sourceTimestamp,
    ...(row.sourceTranscriptId ? { sourceTranscriptId: row.sourceTranscriptId } : {}),
    embedding: row.embedding,
    embeddingModel: row.embeddingModel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    metadata: row.metadata,
  };
}
