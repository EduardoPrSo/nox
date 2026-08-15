import type { AIMessage } from '@jarvis/ai';
export type MemoryKind = 'conversation' | 'preference' | 'fact' | 'event' | 'automation_rule';
export type MemoryRecord = {
  id: string;
  userId: string;
  kind: MemoryKind;
  content: unknown;
  createdAt: Date;
};
export interface MemoryStore {
  getConversationContext(userId: string, limit: number): Promise<AIMessage[]>;
  appendConversation(userId: string, messages: AIMessage[]): Promise<void>;
  search(userId: string, query: string, kinds?: MemoryKind[]): Promise<MemoryRecord[]>;
}
export class InMemoryMemoryStore implements MemoryStore {
  private readonly conversations = new Map<string, AIMessage[]>();
  async getConversationContext(userId: string, limit: number): Promise<AIMessage[]> {
    return (this.conversations.get(userId) ?? []).slice(-limit);
  }
  async appendConversation(userId: string, messages: AIMessage[]): Promise<void> {
    this.conversations.set(
      userId,
      [...(this.conversations.get(userId) ?? []), ...messages].slice(-100),
    );
  }
  async search(): Promise<MemoryRecord[]> {
    return [];
  }
}
