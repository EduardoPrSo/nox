import { randomUUID } from 'node:crypto';
import type { ModelCapability } from '@nox/ai';

export const AI_USAGE_OPERATIONS = [
  'active_request',
  'active_stt',
  'ambient_stt',
  'memory_classification',
  'memory_embedding',
  'memory_retrieval',
  'tts',
] as const;
export type AIUsageOperation = (typeof AI_USAGE_OPERATIONS)[number];

export type AIUsageRecord = {
  id: string;
  requestId: string;
  userId: string;
  deviceId: string;
  sessionId: string;
  conversationId?: string;
  provider: string;
  model: string;
  capability: ModelCapability;
  operation?: AIUsageOperation;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  inputUnits?: string;
  outputUnits?: string;
  unit?: string;
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
