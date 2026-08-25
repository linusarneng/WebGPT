import { buildPromptMessages, type ChatMessage } from '../config/model';
import { deriveTitle, DEFAULT_TITLE, type Conversation, type Message } from '../domain/chat';
import type { ChatRepository } from '../storage/chat-repository';
import { createId } from '../utils/ids';
import { now } from '../utils/time';

export interface GeneratingRef {
  chatId: string;
  assistantId: string;
}

export interface ChatState {
  readonly conversations: readonly Conversation[];
  readonly activeId: string | undefined;
  readonly generating: GeneratingRef | undefined;
  /** Set when persistence degraded, so the UI can warn that history is session-only. */
  readonly storageWarning: string | undefined;
}

type Listener = (state: ChatState) => void;

/** Statuses that mean an assistant reply is still owned by an in-flight request. */
const OPEN_STATUSES = new Set<Message['status']>(['pending', 'streaming']);

function emptyConversation(): Conversation {
  const timestamp = now();
  return {
    id: createId('chat'),
    title: DEFAULT_TITLE,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Immutable, observable chat state. Every mutation produces a new state object and
 * schedules persistence; nothing here touches the DOM or the inference worker.
 */
export class ChatStore {
  private state: ChatState = {
    conversations: [],
    activeId: undefined,
    generating: undefined,
    storageWarning: undefined,
  };
  private readonly listeners = new Set<Listener>();
  private readonly dirty = new Set<string>();
  private readonly removed = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly repository: ChatRepository) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): ChatState {
    return this.state;
  }

  getActiveConversation(): Conversation | undefined {
    return this.state.conversations.find((c) => c.id === this.state.activeId);
  }

  isGenerating(): boolean {
    return this.state.generating !== undefined;
  }

  /** Loads stored conversations, guaranteeing at least one selectable chat. */
  async hydrate(): Promise<void> {
    let stored: Conversation[] = [];
    try {
      stored = await this.repository.list();
    } catch (error) {
      this.setState({
        storageWarning:
          error instanceof Error
            ? `History could not be loaded: ${error.message}`
            : 'History could not be loaded.',
      });
    }
    // Any reply left mid-stream by a refresh is not coming back; mark it honestly.
    const repaired = stored.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        OPEN_STATUSES.has(message.status)
          ? { ...message, status: message.text ? ('stopped' as const) : ('failed' as const), error: message.text ? undefined : 'Interrupted by a page reload.' }
          : message,
      ),
    }));
    const conversations = repaired.length > 0 ? repaired : [emptyConversation()];
    this.setState({ conversations, activeId: conversations[0]?.id });
    if (repaired.length === 0) this.markDirty(conversations[0]!.id);
  }

  newConversation(): string {
    const active = this.getActiveConversation();
    // Reuse an untouched chat rather than stacking up empty entries.
    if (active && active.messages.length === 0) return active.id;
    const conversation = emptyConversation();
    this.setState({
      conversations: [conversation, ...this.state.conversations],
      activeId: conversation.id,
    });
    this.markDirty(conversation.id);
    return conversation.id;
  }

  selectConversation(id: string): void {
    if (!this.state.conversations.some((c) => c.id === id)) return;
    this.setState({ activeId: id });
  }

  renameConversation(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    this.updateConversation(id, (conversation) => ({ ...conversation, title: trimmed }));
  }

  deleteConversation(id: string): void {
    const remaining = this.state.conversations.filter((c) => c.id !== id);
    this.removed.add(id);
    this.dirty.delete(id);
    if (remaining.length === 0) {
      const replacement = emptyConversation();
      this.setState({ conversations: [replacement], activeId: replacement.id });
      this.markDirty(replacement.id);
      return;
    }
    const activeId = this.state.activeId === id ? remaining[0]!.id : this.state.activeId;
    this.setState({ conversations: remaining, activeId });
    this.scheduleFlush();
  }

  /** Adds the user's message plus the empty assistant reply it will stream into. */
  startExchange(prompt: string, chatId = this.state.activeId): { userId: string; assistantId: string } {
    const target = chatId ?? this.newConversation();
    const timestamp = now();
    const userMessage: Message = {
      id: createId('msg'),
      role: 'user',
      text: prompt,
      status: 'done',
      createdAt: timestamp,
    };
    const assistantMessage: Message = {
      id: createId('msg'),
      role: 'assistant',
      text: '',
      status: 'pending',
      createdAt: timestamp + 1,
    };
    this.updateConversation(target, (conversation) => ({
      ...conversation,
      title:
        conversation.title === DEFAULT_TITLE && conversation.messages.length === 0
          ? deriveTitle(prompt)
          : conversation.title,
      messages: [...conversation.messages, userMessage, assistantMessage],
    }));
    return { userId: userMessage.id, assistantId: assistantMessage.id };
  }

  markGenerating(chatId: string, assistantId: string): void {
    this.setState({ generating: { chatId, assistantId } });
  }

  appendChunk(chatId: string, assistantId: string, chunk: string): void {
    this.updateMessage(chatId, assistantId, (message) =>
      // A chunk that lands after stop/error must not resurrect the reply.
      OPEN_STATUSES.has(message.status)
        ? { ...message, text: message.text + chunk, status: 'streaming' }
        : message,
    );
  }

  completeReply(chatId: string, assistantId: string, text: string): void {
    this.updateMessage(chatId, assistantId, (message) =>
      OPEN_STATUSES.has(message.status)
        ? { ...message, text: text || message.text, status: 'done', error: undefined }
        : message,
    );
    this.clearGenerating(assistantId);
  }

  stopReply(chatId: string, assistantId: string, text: string): void {
    this.updateMessage(chatId, assistantId, (message) =>
      OPEN_STATUSES.has(message.status)
        ? { ...message, text: text || message.text, status: 'stopped', error: undefined }
        : message,
    );
    this.clearGenerating(assistantId);
  }

  failReply(chatId: string, assistantId: string, error: string): void {
    this.updateMessage(chatId, assistantId, (message) =>
      OPEN_STATUSES.has(message.status) ? { ...message, status: 'failed', error } : message,
    );
    this.clearGenerating(assistantId);
  }

  /** Resets a failed reply so the same user prompt can be sent again. */
  prepareRetry(chatId: string, assistantId: string): { chatId: string; assistantId: string; prompt: string } | null {
    const conversation = this.state.conversations.find((c) => c.id === chatId);
    if (!conversation) return null;
    const index = conversation.messages.findIndex((m) => m.id === assistantId);
    const reply = conversation.messages[index];
    if (!reply || reply.status !== 'failed') return null;
    const prompt = conversation.messages[index - 1];
    if (!prompt || prompt.role !== 'user') return null;

    this.updateMessage(chatId, assistantId, (message) => ({
      ...message,
      text: '',
      status: 'pending',
      error: undefined,
    }));
    return { chatId, assistantId, prompt: prompt.text };
  }

  /** Bounded chat history for the model, skipping placeholders and failed turns. */
  buildPromptFor(chatId: string): ChatMessage[] {
    const conversation = this.state.conversations.find((c) => c.id === chatId);
    if (!conversation) return buildPromptMessages([]);
    const history = conversation.messages
      .filter((m) => m.role === 'user' || (m.text.trim() !== '' && m.status !== 'failed'))
      .map((m) => ({ role: m.role, content: m.text }) satisfies ChatMessage);
    return buildPromptMessages(history);
  }

  setStorageWarning(warning: string | undefined): void {
    this.setState({ storageWarning: warning });
  }

  /** Writes every pending change immediately; used by tests and `beforeunload`. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const dirty = [...this.dirty];
    const removed = [...this.removed];
    this.dirty.clear();
    this.removed.clear();
    try {
      for (const id of removed) await this.repository.delete(id);
      for (const id of dirty) {
        const conversation = this.state.conversations.find((c) => c.id === id);
        if (conversation) await this.repository.save(conversation);
      }
    } catch (error) {
      this.setState({
        storageWarning:
          error instanceof Error
            ? `History is not being saved: ${error.message}`
            : 'History is not being saved.',
      });
    }
  }

  private clearGenerating(assistantId: string): void {
    if (this.state.generating?.assistantId === assistantId) {
      this.setState({ generating: undefined });
    }
  }

  private updateConversation(id: string, update: (conversation: Conversation) => Conversation): void {
    let changed = false;
    const conversations = this.state.conversations.map((conversation) => {
      if (conversation.id !== id) return conversation;
      const next = update(conversation);
      if (next === conversation) return conversation;
      changed = true;
      return { ...next, updatedAt: now() };
    });
    if (!changed) return;
    this.setState({ conversations });
    this.markDirty(id);
  }

  private updateMessage(chatId: string, messageId: string, update: (message: Message) => Message): void {
    this.updateConversation(chatId, (conversation) => {
      let changed = false;
      const messages = conversation.messages.map((message) => {
        if (message.id !== messageId) return message;
        const next = update(message);
        if (next !== message) changed = true;
        return next;
      });
      return changed ? { ...conversation, messages } : conversation;
    });
  }

  private markDirty(id: string): void {
    this.dirty.add(id);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    // Coalesce the write burst that streaming produces into one save.
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, 400);
  }

  private setState(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener(this.state);
  }
}
