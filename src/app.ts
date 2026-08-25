import { getModel, type ModelId } from './config/model';
import { InferenceClient, type WorkerFactory } from './inference/inference-client';
import type { WorkerEvent } from './inference/protocol';
import { ChatStore } from './state/chat-store';
import { createChatRepository, MemoryChatRepository, type ChatRepository } from './storage/chat-repository';
import { createModelPreference, type ModelPreference } from './storage/model-preference';
import { createGenerationTelemetry } from './telemetry/runtime-telemetry';
import { createAppShell } from './ui/app-shell';
import { createChatView } from './ui/chat-view';
import { createComposer } from './ui/composer';
import { createModelMenu } from './ui/model-menu';
import type { ModelStatusState } from './ui/model-status';
import { createSidebar } from './ui/sidebar';
import { createId } from './utils/ids';

export interface AppOptions {
  root: HTMLElement;
  repository?: ChatRepository;
  workerFactory?: WorkerFactory;
  modelPreference?: ModelPreference;
}

export interface App {
  destroy(): void;
}

/** Tracks per-file download bytes so the pill can show one honest overall percentage. */
class DownloadProgress {
  private readonly files = new Map<string, { loaded: number; total: number }>();

  update(event: Extract<WorkerEvent, { type: 'progress' }>): void {
    if (!event.total) return;
    this.files.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
  }

  percent(): number | undefined {
    if (this.files.size === 0) return undefined;
    let loaded = 0;
    let total = 0;
    for (const file of this.files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    return total > 0 ? (loaded / total) * 100 : undefined;
  }

  reset(): void {
    this.files.clear();
  }
}

export async function createApp(options: AppOptions): Promise<App> {
  const repository = options.repository ?? (await createChatRepository());
  const store = new ChatStore(repository);
  const client = new InferenceClient(options.workerFactory);
  const modelPreference = options.modelPreference ?? createModelPreference();
  const progress = new DownloadProgress();
  const generation = createGenerationTelemetry();

  let selectedId: ModelId = modelPreference.get();
  let loadedId: ModelId | undefined;
  let runtime: Omit<ModelStatusState, 'model'> = { status: 'idle' };
  let runtimeWarning: string | undefined;
  /** Request id of the generation currently owned by the UI, if any. */
  let activeRequestId: string | undefined;

  const status = createModelMenu({
    onSelect: (id) => selectModel(id),
    onLoad: () => loadSelectedModel(),
  });

  const sidebar = createSidebar({
    onNewChat: () => {
      store.newConversation();
      shell.closeDrawer();
      composer.focus();
    },
    onSelect: (id) => {
      store.selectConversation(id);
      shell.closeDrawer();
      composer.focus();
    },
    onRename: (id, title) => store.renameConversation(id, title),
    onDelete: (id) => store.deleteConversation(id),
  });

  const chatView = createChatView({
    onStarterPrompt: (prompt) => {
      if (runtime.status !== 'ready') {
        composer.setValue(prompt);
        composer.focus();
        if (runtime.status === 'idle') loadSelectedModel();
        return;
      }
      void send(prompt);
    },
    onLoadModel: () => {
      loadSelectedModel();
    },
    onSelectModel: (id) => selectModel(id),
    onRetry: (messageId) => {
      const chatId = store.getState().activeId;
      if (!chatId) return;
      const retry = store.prepareRetry(chatId, messageId);
      if (retry) void run(retry.chatId, retry.assistantId);
    },
    onCopy: (text) => {
      void navigator.clipboard?.writeText(text).catch(() => {
        /* Clipboard access can be denied; the copy button simply does nothing. */
      });
    },
  });

  const composer = createComposer({
    onSend: (text) => void send(text),
    onStop: () => {
      if (activeRequestId) client.abort(activeRequestId);
    },
  });

  const shell = createAppShell({ sidebar, chatView, composer, status });
  options.root.replaceChildren(shell.element);

  function placeholder(): string {
    switch (runtime.status) {
      case 'ready':
        return 'Message WebGPT…';
      case 'loading':
        return 'Loading the model…';
      case 'error':
        return 'The model is unavailable.';
      default:
        return 'Load the model to start chatting.';
    }
  }

  function render(): void {
    const state = store.getState();
    const conversation = store.getActiveConversation();
    sidebar.render(state.conversations, state.activeId);
    sidebar.renderTechnical({
      selectedId,
      loadedId,
      backend: runtime.backend,
      status: runtime.status,
      phase: runtime.phase,
      progress: runtime.percent,
      error: runtime.error,
      generation: generation.snapshot(globalThis.performance.now()),
    });
    chatView.render({
      conversation,
      model: getModel(loadedId ?? selectedId),
      selectedId,
      loadedId,
      locked: store.isGenerating(),
      lockReason: store.isGenerating() ? 'Stop the reply before changing models.' : undefined,
      runtimeStatus: runtime.status,
      runtimeError: runtime.error,
      runtimeWarning,
      storageWarning: state.storageWarning,
      runtimePhase: runtime.phase,
      runtimePercent: runtime.percent,
    });
    composer.render({
      generating: store.isGenerating(),
      disabled: runtime.status !== 'ready',
      placeholder: placeholder(),
    });
    status.render({
      ...runtime,
      model: getModel(loadedId ?? selectedId),
      selectedId,
      loadedId,
      locked: store.isGenerating(),
      lockReason: store.isGenerating() ? 'Stop the reply before changing models.' : undefined,
    });
    shell.setTitle(conversation?.title ?? 'New chat');
  }

  /** Streams one assistant reply, keeping every outcome tied to its own chat. */
  async function run(chatId: string, assistantId: string): Promise<void> {
    const requestId = createId('req');
    activeRequestId = requestId;
    generation.start(globalThis.performance.now());
    store.markGenerating(chatId, assistantId);
    render();

    try {
      const result = await client.generate(
        { requestId, messages: store.buildPromptFor(chatId) },
        (chunk) => store.appendChunk(chatId, assistantId, chunk),
      );
      if (result.outcome === 'complete') store.completeReply(chatId, assistantId, result.text);
      else if (result.outcome === 'stopped') store.stopReply(chatId, assistantId, result.text);
      else store.failReply(chatId, assistantId, result.error);
    } catch (error) {
      store.failReply(
        chatId,
        assistantId,
        error instanceof Error ? error.message : 'Generation failed.',
      );
    } finally {
      generation.finish(globalThis.performance.now());
      if (activeRequestId === requestId) activeRequestId = undefined;
      void store.flush();
      render();
    }
  }

  async function send(text: string): Promise<void> {
    // One generation at a time keeps the worker and the context window predictable.
    if (store.isGenerating() || runtime.status !== 'ready') return;
    const chatId = store.getState().activeId ?? store.newConversation();
    const { assistantId } = store.startExchange(text, chatId);
    await run(chatId, assistantId);
  }

  /** A new selection releases model memory but leaves local conversations intact. */
  function selectModel(id: ModelId): void {
    if (store.isGenerating() || id === selectedId) return;
    selectedId = id;
    modelPreference.set(id);
    loadedId = undefined;
    runtimeWarning = undefined;
    progress.reset();
    runtime = { status: 'idle' };
    client.reset();
    render();
  }

  /** Loading is always explicit, including after a model switch. */
  function loadSelectedModel(): void {
    if (store.isGenerating() || runtime.status === 'loading') return;
    progress.reset();
    runtimeWarning = undefined;
    client.initialize(selectedId);
  }

  const unsubscribeStore = store.subscribe(render);

  const unsubscribeClient = client.subscribe((event) => {
    switch (event.type) {
      case 'status':
        runtime = { ...runtime, status: event.status, detail: event.detail, phase: event.phase };
        break;
      case 'progress':
        progress.update(event);
        runtime = { ...runtime, status: 'loading', phase: runtime.phase ?? 'downloading', percent: progress.percent() };
        break;
      case 'ready':
        progress.reset();
        runtimeWarning = event.warning;
        loadedId = event.model;
        runtime = { status: 'ready', backend: event.backend };
        composer.focus();
        break;
      case 'token-count':
        if (event.requestId === activeRequestId) generation.recordTokens(event.count, globalThis.performance.now());
        break;
      case 'error':
        if (!event.requestId) runtime = { status: 'error', error: event.message };
        break;
      default:
        return;
    }
    render();
  });

  const handleUnload = (): void => void store.flush();
  globalThis.addEventListener?.('beforeunload', handleUnload);

  await store.hydrate();
  render();

  return {
    destroy() {
      unsubscribeStore();
      unsubscribeClient();
      globalThis.removeEventListener?.('beforeunload', handleUnload);
      sidebar.destroy();
      client.dispose();
      options.root.replaceChildren();
    },
  };
}

export { MemoryChatRepository };
