import { ConversationNotFoundError, InMemoryMemoryStore } from '@nox/memory';

describe('Conversation memory', () => {
  it('creates conversations, persists messages and returns a limited recent context', async () => {
    const memory = new InMemoryMemoryStore();
    const conversation = await memory.createConversation({ userId: 'owner', deviceId: 'phone' });
    await memory.appendConversation(conversation.id, 'owner', [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]);

    await expect(memory.getConversation(conversation.id, 'owner')).resolves.toMatchObject({
      id: conversation.id,
      userId: 'owner',
      deviceId: 'phone',
    });
    await expect(memory.getConversationContext(conversation.id, 'owner', 2)).resolves.toEqual([
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]);
  });

  it('uses the same not-found behavior for missing and foreign conversations', async () => {
    const memory = new InMemoryMemoryStore();
    const conversation = await memory.createConversation({ userId: 'owner', deviceId: 'phone' });

    await expect(memory.getConversation(conversation.id, 'attacker')).resolves.toBeUndefined();
    await expect(
      memory.getConversationContext(conversation.id, 'attacker', 20),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(
      memory.getConversationContext('11111111-1111-4111-8111-111111111111', 'owner', 20),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});
