import { randomUUID } from 'node:crypto';
import type { ModelCapability } from '@nox/ai';

export type AIUsageRecord = {
  id: string;
  requestId: string;
  userId: string;
  deviceId: string;
  sessionId: string;
  conversationId: string;
  provider: string;
  model: string;
  capability: ModelCapability;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  latencyMs?: number;
  estimatedCost?: string;
  createdAt: Date;
};

export type NewAIUsageRecord = Omit<AIUsageRecord, 'id' | 'createdAt'>;

export interface AIUsageRepository {
  record(input: NewAIUsageRecord): Promise<void>;
}

export class InMemoryAIUsageRepository implements AIUsageRepository {
  readonly records: AIUsageRecord[] = [];

  async record(input: NewAIUsageRecord): Promise<void> {
    this.records.push({ ...input, id: randomUUID(), createdAt: new Date() });
  }
}

export type BudgetLimits = {
  daily?: string;
  monthly?: string;
  maxPerRequest?: string;
};

export type BudgetPolicyInput = {
  userId: string;
  requestedCapability: ModelCapability;
  critical: boolean;
};

export type BudgetDecision = {
  capability: ModelCapability;
  action: 'ALLOW' | 'DOWNGRADE' | 'DENY';
  reason?: string;
};

export interface BudgetPolicy {
  evaluate(input: BudgetPolicyInput): Promise<BudgetDecision>;
}
