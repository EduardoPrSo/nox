import { fileURLToPath } from 'node:url';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import type { AIMessage, MessageContent, ModelCapability, ToolCall } from '@nox/ai';
import type { AuditRepository } from '@nox/audit';
import { sanitize } from '@nox/audit';
import type { ConfirmationRepository, PendingConfirmation } from '@nox/confirmations';
import { hashArguments } from '@nox/confirmations';
import type { Conversation, MemoryRecord, MemoryStore } from '@nox/memory';
import { ConversationNotFoundError } from '@nox/memory';
import type { AIUsageRepository, NewAIUsageRecord } from '@nox/usage';

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
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    cachedTokens: integer('cached_tokens'),
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
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.totalTokens,
      cachedTokens: input.cachedTokens,
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
