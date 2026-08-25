import type {
  Backend,
  GenerateRequest,
  GenerationResult,
  RuntimeStatus,
  WorkerCommand,
  WorkerEvent,
} from './protocol';

export type WorkerFactory = () => Worker;

type Listener = (event: WorkerEvent) => void;

interface PendingGeneration {
  text: string;
  onChunk: (chunk: string) => void;
  resolve: (result: GenerationResult) => void;
}

const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });

/**
 * Owns the inference worker and turns its message stream into promises and callbacks.
 * Deliberately free of any Transformers.js import so the main bundle stays small.
 */
export class InferenceClient {
  private worker: Worker | undefined;
  private status: RuntimeStatus = 'idle';
  private backend: Backend | undefined;
  private error: string | undefined;
  private warning: string | undefined;
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<string, PendingGeneration>();

  constructor(private readonly createWorker: WorkerFactory = defaultWorkerFactory) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  getBackend(): Backend | undefined {
    return this.backend;
  }

  getError(): string | undefined {
    return this.error;
  }

  getWarning(): string | undefined {
    return this.warning;
  }

  /** Spawns the worker on first call and asks it to load the model. Safe to retry. */
  initialize(): void {
    this.error = undefined;
    this.status = 'loading';
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.addEventListener('message', this.handleMessage);
      this.worker.addEventListener('error', this.handleCrash);
    }
    this.post({ type: 'initialize' });
    this.emit({ type: 'status', status: 'loading' });
  }

  generate(request: GenerateRequest, onChunk: (chunk: string) => void): Promise<GenerationResult> {
    if (this.status !== 'ready' || !this.worker) {
      return Promise.reject(new Error('Local model is not ready yet.'));
    }
    return new Promise<GenerationResult>((resolve) => {
      this.pending.set(request.requestId, { text: '', onChunk, resolve });
      this.post({ type: 'generate', requestId: request.requestId, messages: request.messages });
    });
  }

  abort(requestId: string): void {
    if (!this.pending.has(requestId)) return;
    this.post({ type: 'abort', requestId });
  }

  dispose(): void {
    this.settleAll('Inference worker was shut down.');
    this.worker?.removeEventListener('message', this.handleMessage);
    this.worker?.removeEventListener('error', this.handleCrash);
    this.worker?.terminate();
    this.worker = undefined;
    this.status = 'idle';
    this.backend = undefined;
    this.error = undefined;
  }

  private post(command: WorkerCommand): void {
    this.worker?.postMessage(command);
  }

  private emit(event: WorkerEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private readonly handleMessage = (event: Event): void => {
    const data = (event as MessageEvent<WorkerEvent>).data;
    if (!data) return;
    this.applyEvent(data);
    this.emit(data);
  };

  private readonly handleCrash = (event: Event): void => {
    const message = (event as ErrorEvent).message || 'The inference worker stopped unexpectedly.';
    this.status = 'error';
    this.error = message;
    this.settleAll(message);
    this.emit({ type: 'error', code: 'worker-crashed', message });
  };

  private applyEvent(event: WorkerEvent): void {
    switch (event.type) {
      case 'status':
        this.status = event.status;
        break;
      case 'ready':
        this.status = 'ready';
        this.backend = event.backend;
        this.warning = event.warning;
        this.error = undefined;
        break;
      case 'token': {
        const pending = this.pending.get(event.requestId);
        if (!pending) return; // Stale token from an already-settled request.
        pending.text += event.text;
        pending.onChunk(event.text);
        break;
      }
      case 'complete':
        this.settle(event.requestId, { outcome: 'complete', text: event.text });
        break;
      case 'aborted':
        this.settle(event.requestId, { outcome: 'stopped', text: event.text });
        break;
      case 'error':
        if (event.requestId) {
          const partial = this.pending.get(event.requestId)?.text ?? '';
          this.settle(event.requestId, {
            outcome: 'error',
            text: partial,
            error: event.message,
          });
        } else {
          this.status = 'error';
          this.error = event.message;
        }
        break;
      case 'progress':
        break;
    }
  }

  private settle(requestId: string, result: GenerationResult): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.resolve(result);
  }

  private settleAll(error: string): void {
    for (const [requestId, pending] of [...this.pending]) {
      this.pending.delete(requestId);
      pending.resolve({ outcome: 'error', text: pending.text, error });
    }
  }
}
