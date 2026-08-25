import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createChatRepository, IndexedDbChatRepository, MemoryChatRepository } from '../src/storage/chat-repository';
import type { Conversation } from '../src/domain/chat';

function conversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    messages: [
      { id: `${id}-m1`, role: 'user', text: 'hello', status: 'done', createdAt: 1 },
      { id: `${id}-m2`, role: 'assistant', text: 'hi there', status: 'done', createdAt: 2 },
    ],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('IndexedDbChatRepository', () => {
  let repo: IndexedDbChatRepository;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    repo = new IndexedDbChatRepository('webgpt-test');
  });

  it('returns an empty list on a fresh database', async () => {
    await expect(repo.list()).resolves.toEqual([]);
  });

  it('round-trips a conversation with all of its messages', async () => {
    await repo.save(conversation('a'));
    const [loaded] = await repo.list();
    expect(loaded).toEqual(conversation('a'));
    expect(loaded?.messages).toHaveLength(2);
  });

  it('overwrites an existing conversation on repeated save', async () => {
    await repo.save(conversation('a'));
    await repo.save(conversation('a', { title: 'Renamed', updatedAt: 99 }));
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('Renamed');
  });

  it('lists conversations newest-updated first', async () => {
    await repo.save(conversation('old', { updatedAt: 10 }));
    await repo.save(conversation('new', { updatedAt: 20 }));
    await repo.save(conversation('mid', { updatedAt: 15 }));
    expect((await repo.list()).map((c) => c.id)).toEqual(['new', 'mid', 'old']);
  });

  it('deletes a conversation', async () => {
    await repo.save(conversation('a'));
    await repo.save(conversation('b'));
    await repo.delete('a');
    expect((await repo.list()).map((c) => c.id)).toEqual(['b']);
  });

  it('survives a fresh repository instance against the same database', async () => {
    await repo.save(conversation('persisted'));
    const reopened = new IndexedDbChatRepository('webgpt-test');
    expect((await reopened.list()).map((c) => c.id)).toEqual(['persisted']);
  });
});

describe('MemoryChatRepository', () => {
  it('behaves like the persistent repository within a session', async () => {
    const repo = new MemoryChatRepository();
    await repo.save(conversation('a', { updatedAt: 5 }));
    await repo.save(conversation('b', { updatedAt: 9 }));
    expect((await repo.list()).map((c) => c.id)).toEqual(['b', 'a']);
    await repo.delete('b');
    expect((await repo.list()).map((c) => c.id)).toEqual(['a']);
  });
});

describe('createChatRepository', () => {
  it('falls back to in-memory storage when IndexedDB is unavailable', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error deliberately simulating a private-mode browser
    delete globalThis.indexedDB;
    const repo = await createChatRepository('webgpt-test');
    expect(repo).toBeInstanceOf(MemoryChatRepository);
    globalThis.indexedDB = original;
  });

  it('returns the IndexedDB repository when the database opens', async () => {
    globalThis.indexedDB = new IDBFactory();
    const repo = await createChatRepository('webgpt-test');
    expect(repo).toBeInstanceOf(IndexedDbChatRepository);
  });
});
