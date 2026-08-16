import { createHash, randomUUID } from 'node:crypto';
export type PendingConfirmation = {
  id: string;
  userId: string;
  requestId: string;
  conversationId?: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  argumentsHash: string;
  description: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
};
type NewConfirmation = Omit<
  PendingConfirmation,
  'id' | 'createdAt' | 'expiresAt' | 'status' | 'argumentsHash'
>;
export interface ConfirmationRepository {
  create(input: NewConfirmation): Promise<PendingConfirmation>;
  resolve(id: string, userId: string, approve: boolean): Promise<PendingConfirmation | undefined>;
}
export class InMemoryConfirmationRepository implements ConfirmationRepository {
  private readonly values = new Map<string, PendingConfirmation>();
  constructor(private readonly ttlMs = 300_000) {}
  async create(input: NewConfirmation): Promise<PendingConfirmation> {
    const createdAt = new Date();
    const value: PendingConfirmation = {
      ...input,
      id: randomUUID(),
      argumentsHash: hashArguments(input.arguments),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + this.ttlMs),
      status: 'pending',
    };
    this.values.set(value.id, value);
    return value;
  }
  async resolve(
    id: string,
    userId: string,
    approve: boolean,
  ): Promise<PendingConfirmation | undefined> {
    const value = this.values.get(id);
    if (!value || value.userId !== userId || value.status !== 'pending') return undefined;
    if (value.expiresAt.getTime() <= Date.now()) {
      value.status = 'expired';
      return value;
    }
    value.status = approve ? 'approved' : 'rejected';
    return value;
  }
}
export function hashArguments(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
