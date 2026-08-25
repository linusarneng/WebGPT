import type { Conversation } from '../domain/chat';

/** Persistence boundary. UI and state modules only ever see this interface. */
export interface ChatRepository {
  list(): Promise<Conversation[]>;
  save(conversation: Conversation): Promise<void>;
  delete(id: string): Promise<void>;
}

const STORE = 'conversations';
const DB_VERSION = 1;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbChatRepository implements ChatRepository {
  private db: Promise<IDBDatabase> | undefined;

  constructor(private readonly dbName = 'webgpt') {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the local database'));
      req.onblocked = () => reject(new Error('The local database is blocked by another tab'));
    });
    return this.db;
  }

  async list(): Promise<Conversation[]> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readonly');
    const all = await request(tx.objectStore(STORE).getAll() as IDBRequest<Conversation[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async save(conversation: Conversation): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    // Structured clone rejects proxies/getters, so store a plain snapshot.
    await request(tx.objectStore(STORE).put(structuredClone(conversation)));
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    await request(tx.objectStore(STORE).delete(id));
  }
}

/** Session-only fallback used in private mode or when storage quota is denied. */
export class MemoryChatRepository implements ChatRepository {
  private readonly items = new Map<string, Conversation>();

  async list(): Promise<Conversation[]> {
    return [...this.items.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async save(conversation: Conversation): Promise<void> {
    this.items.set(conversation.id, structuredClone(conversation));
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

/**
 * Returns the durable repository when IndexedDB is usable, otherwise degrades to
 * memory so the app still works instead of failing at startup.
 */
export async function createChatRepository(dbName = 'webgpt'): Promise<ChatRepository> {
  if (typeof indexedDB === 'undefined') return new MemoryChatRepository();
  try {
    const repo = new IndexedDbChatRepository(dbName);
    await repo.list();
    return repo;
  } catch {
    return new MemoryChatRepository();
  }
}
