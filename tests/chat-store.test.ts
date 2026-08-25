import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatStore } from '../src/state/chat-store';
import { MemoryChatRepository } from '../src/storage/chat-repository';
import { DEFAULT_TITLE } from '../src/domain/chat';

function makeStore() {
  const repo = new MemoryChatRepository();
  return { store: new ChatStore(repo), repo };
}

describe('ChatStore', () => {
  let store: ChatStore;
  let repo: MemoryChatRepository;

  beforeEach(() => {
    ({ store, repo } = makeStore());
  });

  it('starts with a single empty conversation after hydrate on a clean store', async () => {
    await store.hydrate();
    expect(store.getState().conversations).toHaveLength(1);
    expect(store.getActiveConversation()?.title).toBe(DEFAULT_TITLE);
    expect(store.getActiveConversation()?.messages).toEqual([]);
  });

  it('restores saved conversations and selects the most recent one', async () => {
    await repo.save({ id: 'a', title: 'A', messages: [], createdAt: 1, updatedAt: 10 });
    await repo.save({ id: 'b', title: 'B', messages: [], createdAt: 1, updatedAt: 20 });
    await store.hydrate();
    expect(store.getState().conversations.map((c) => c.id)).toEqual(['b', 'a']);
    expect(store.getState().activeId).toBe('b');
  });

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const spy = vi.fn();
    const off = store.subscribe(spy);
    await store.hydrate();
    expect(spy).toHaveBeenCalled();
    const count = spy.mock.calls.length;
    off();
    store.newConversation();
    expect(spy.mock.calls.length).toBe(count);
  });

  it('does not create a second empty chat when one is already active', async () => {
    await store.hydrate();
    const firstId = store.getState().activeId;
    store.newConversation();
    expect(store.getState().conversations).toHaveLength(1);
    expect(store.getState().activeId).toBe(firstId);
  });

  it('appends a user message and a pending assistant placeholder', async () => {
    await store.hydrate();
    const { userId, assistantId } = store.startExchange('What is a photon?');
    const messages = store.getActiveConversation()!.messages;
    expect(messages.map((m) => [m.role, m.status])).toEqual([
      ['user', 'done'],
      ['assistant', 'pending'],
    ]);
    expect(messages[0]?.id).toBe(userId);
    expect(messages[1]?.id).toBe(assistantId);
    expect(messages[1]?.text).toBe('');
  });

  it('titles the conversation from the first user message only', async () => {
    await store.hydrate();
    store.startExchange('Explain gradient descent');
    expect(store.getActiveConversation()?.title).toBe('Explain gradient descent');
    store.completeReply(store.getState().activeId!, store.getActiveConversation()!.messages[1]!.id, 'ok');
    store.startExchange('Second question entirely');
    expect(store.getActiveConversation()?.title).toBe('Explain gradient descent');
  });

  it('appends streamed chunks and flips the reply to streaming', async () => {
    await store.hydrate();
    const chatId = store.getState().activeId!;
    const { assistantId } = store.startExchange('hi');
    store.appendChunk(chatId, assistantId, 'Hel');
    store.appendChunk(chatId, assistantId, 'lo');
    const reply = store.getActiveConversation()!.messages[1]!;
    expect(reply.text).toBe('Hello');
    expect(reply.status).toBe('streaming');
  });

  it('marks a reply done, stopped or failed', async () => {
    await store.hydrate();
    const chatId = store.getState().activeId!;
    const a = store.startExchange('one');
    store.completeReply(chatId, a.assistantId, 'done text');
    expect(store.getActiveConversation()!.messages[1]).toMatchObject({ status: 'done', text: 'done text' });

    const b = store.startExchange('two');
    store.appendChunk(chatId, b.assistantId, 'partial');
    store.stopReply(chatId, b.assistantId, 'partial');
    expect(store.getActiveConversation()!.messages[3]).toMatchObject({ status: 'stopped', text: 'partial' });

    const c = store.startExchange('three');
    store.appendChunk(chatId, c.assistantId, 'half');
    store.failReply(chatId, c.assistantId, 'model exploded');
    expect(store.getActiveConversation()!.messages[5]).toMatchObject({
      status: 'failed',
      text: 'half',
      error: 'model exploded',
    });
  });

  it('keeps state immutable between updates', async () => {
    await store.hydrate();
    const before = store.getState();
    store.startExchange('hi');
    const after = store.getState();
    expect(after).not.toBe(before);
    expect(before.conversations[0]?.messages).toHaveLength(0);
  });

  it('renames and deletes conversations', async () => {
    await store.hydrate();
    const first = store.getState().activeId!;
    store.startExchange('seed');
    store.completeReply(first, store.getActiveConversation()!.messages[1]!.id, 'x');
    const second = store.newConversation();

    store.renameConversation(first, '  Renamed chat  ');
    expect(store.getState().conversations.find((c) => c.id === first)?.title).toBe('Renamed chat');

    store.renameConversation(first, '   ');
    expect(store.getState().conversations.find((c) => c.id === first)?.title).toBe('Renamed chat');

    store.deleteConversation(second);
    expect(store.getState().conversations.map((c) => c.id)).toEqual([first]);
    expect(store.getState().activeId).toBe(first);
  });

  it('always leaves an empty conversation behind when the last one is deleted', async () => {
    await store.hydrate();
    const only = store.getState().activeId!;
    store.startExchange('hi');
    store.deleteConversation(only);
    expect(store.getState().conversations).toHaveLength(1);
    expect(store.getActiveConversation()?.messages).toEqual([]);
    expect(store.getState().activeId).not.toBe(only);
  });

  it('persists conversations to the repository', async () => {
    await store.hydrate();
    const chatId = store.getState().activeId!;
    const { assistantId } = store.startExchange('persist me');
    store.completeReply(chatId, assistantId, 'saved');
    await store.flush();

    const revived = new ChatStore(repo);
    await revived.hydrate();
    expect(revived.getActiveConversation()?.messages.map((m) => m.text)).toEqual(['persist me', 'saved']);
  });

  it('removes deleted conversations from the repository', async () => {
    await store.hydrate();
    const chatId = store.getState().activeId!;
    store.startExchange('gone');
    await store.flush();
    store.deleteConversation(chatId);
    await store.flush();
    expect((await repo.list()).map((c) => c.id)).not.toContain(chatId);
  });

  it('builds bounded prompt history from the conversation, excluding the placeholder', async () => {
    await store.hydrate();
    const chatId = store.getState().activeId!;
    const a = store.startExchange('first');
    store.completeReply(chatId, a.assistantId, 'reply one');
    store.startExchange('second');
    const prompt = store.buildPromptFor(chatId);
    expect(prompt[0]?.role).toBe('system');
    expect(prompt.slice(1)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply one' },
      { role: 'user', content: 'second' },
    ]);
  });

  it('omits failed and empty assistant turns from prompt history', async () => {
    await store.hydrate();
    const chatId = store.getState().activeId!;
    const a = store.startExchange('q1');
    store.failReply(chatId, a.assistantId, 'nope');
    store.startExchange('q2');
    expect(store.buildPromptFor(chatId).slice(1)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  it('retries by resetting the failed reply to pending and reusing the prompt', async () => {
    await store.hydrate();
    const chatId = store.getState().activeId!;
    const { assistantId } = store.startExchange('ask again');
    store.failReply(chatId, assistantId, 'network');
    const retry = store.prepareRetry(chatId, assistantId);
    expect(retry).toEqual({ chatId, assistantId, prompt: 'ask again' });
    const reply = store.getActiveConversation()!.messages[1]!;
    expect(reply.status).toBe('pending');
    expect(reply.text).toBe('');
    expect(reply.error).toBeUndefined();
  });

  it('returns null when retry is requested for a reply that did not fail', async () => {
    await store.hydrate();
    const chatId = store.getState().activeId!;
    const { assistantId } = store.startExchange('fine');
    store.completeReply(chatId, assistantId, 'ok');
    expect(store.prepareRetry(chatId, assistantId)).toBeNull();
  });
});

describe('ChatStore race conditions', () => {
  let store: ChatStore;

  beforeEach(async () => {
    store = new ChatStore(new MemoryChatRepository());
    await store.hydrate();
  });

  it('ignores a late chunk arriving after the reply was stopped', () => {
    const chatId = store.getState().activeId!;
    const { assistantId } = store.startExchange('hi');
    store.appendChunk(chatId, assistantId, 'kept');
    store.stopReply(chatId, assistantId, 'kept');
    store.appendChunk(chatId, assistantId, ' LATE');
    const reply = store.getActiveConversation()!.messages[1]!;
    expect(reply.text).toBe('kept');
    expect(reply.status).toBe('stopped');
  });

  it('ignores a late completion after the reply was stopped', () => {
    const chatId = store.getState().activeId!;
    const { assistantId } = store.startExchange('hi');
    store.stopReply(chatId, assistantId, '');
    store.completeReply(chatId, assistantId, 'should not appear');
    expect(store.getActiveConversation()!.messages[1]).toMatchObject({ status: 'stopped', text: '' });
  });

  it('keeps partial text when an error arrives mid-stream', () => {
    const chatId = store.getState().activeId!;
    const { assistantId } = store.startExchange('hi');
    store.appendChunk(chatId, assistantId, 'partial answer');
    store.failReply(chatId, assistantId, 'runtime error');
    expect(store.getActiveConversation()!.messages[1]).toMatchObject({
      text: 'partial answer',
      status: 'failed',
    });
  });

  it('streams into the originating chat even after the user switches conversations', () => {
    const original = store.getState().activeId!;
    const { assistantId } = store.startExchange('long question');
    const other = store.newConversation();
    store.selectConversation(other);

    store.appendChunk(original, assistantId, 'streamed while away');
    store.completeReply(original, assistantId, 'streamed while away');

    expect(store.getActiveConversation()?.id).toBe(other);
    expect(store.getActiveConversation()?.messages).toEqual([]);
    const source = store.getState().conversations.find((c) => c.id === original)!;
    expect(source.messages[1]).toMatchObject({ text: 'streamed while away', status: 'done' });
  });

  it('drops stream updates aimed at a conversation the user deleted', () => {
    const chatId = store.getState().activeId!;
    const { assistantId } = store.startExchange('hi');
    store.newConversation();
    store.deleteConversation(chatId);
    expect(() => store.appendChunk(chatId, assistantId, 'ghost')).not.toThrow();
    expect(store.getState().conversations.some((c) => c.id === chatId)).toBe(false);
  });

  it('tracks which conversation is generating so parallel sends can be blocked', () => {
    const chatId = store.getState().activeId!;
    expect(store.isGenerating()).toBe(false);
    const { assistantId } = store.startExchange('hi');
    store.markGenerating(chatId, assistantId);
    expect(store.isGenerating()).toBe(true);
    expect(store.getState().generating).toEqual({ chatId, assistantId });
    store.completeReply(chatId, assistantId, 'done');
    expect(store.isGenerating()).toBe(false);
  });
});
