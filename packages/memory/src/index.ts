import { randomUUID } from 'node:crypto';
import type { AIMessage } from '@nox/ai';

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
