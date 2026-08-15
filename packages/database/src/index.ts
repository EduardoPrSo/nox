import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import type { AuditRepository } from '@jarvis/audit';
import { sanitize } from '@jarvis/audit';
import type { ConfirmationRepository, PendingConfirmation } from '@jarvis/confirmations';
import { hashArguments } from '@jarvis/confirmations';

export const confirmationStatus = pgEnum('confirmation_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
]);
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull(),
  userId: text('user_id').notNull(),
  type: text('type').notNull(),
  data: jsonb('data').notNull(),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const confirmations = pgTable('confirmations', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull(),
  userId: text('user_id').notNull(),
  toolCallId: text('tool_call_id').notNull(),
  toolName: text('tool_name').notNull(),
  arguments: jsonb('arguments').notNull(),
  argumentsHash: text('arguments_hash').notNull(),
  description: text('description').notNull(),
  status: confirmationStatus('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

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
export function createPostgresRepositories(databaseUrl: string, confirmationTtlMs: number) {
  const client = postgres(databaseUrl, { prepare: false, max: 10 });
  const db = drizzle(client);
  return {
    audit: new DrizzleAuditRepository(db),
    confirmations: new DrizzleConfirmationRepository(db, confirmationTtlMs),
    close: async () => client.end(),
  };
}
function mapConfirmation(row: typeof confirmations.$inferSelect): PendingConfirmation {
  return {
    id: row.id,
    userId: row.userId,
    requestId: row.requestId,
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
