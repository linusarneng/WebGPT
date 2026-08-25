import { beforeEach, describe, expect, it } from 'vitest';
import { InferenceClient } from '../src/inference/inference-client';
import type { WorkerCommand, WorkerEvent } from '../src/inference/protocol';

class FakeWorker implements Pick<Worker, 'postMessage' | 'terminate'> {
  static latest: FakeWorker | undefined;
  readonly sent: WorkerCommand[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(event: Event) => void>>();

  constructor() {
    FakeWorker.latest = this;
  }
  postMessage(command: WorkerCommand): void {
    this.sent.push(command);
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: string, listener: (event: Event) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(event: WorkerEvent): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: event } as MessageEvent<WorkerEvent> as unknown as Event);
    }
  }
  emitCrash(message: string): void {
    for (const listener of this.listeners.get('error') ?? []) {
      listener({ message } as ErrorEvent as unknown as Event);
    }
  }
}

function makeClient() {
  const client = new InferenceClient(() => new FakeWorker() as unknown as Worker);
  const events: WorkerEvent[] = [];
  client.subscribe((event) => events.push(event));
  return { client, events, worker: () => FakeWorker.latest! };
}

describe('InferenceClient', () => {
  beforeEach(() => {
    FakeWorker.latest = undefined;
  });

  it('does not spawn a worker until initialize() is called', () => {
    const { client } = makeClient();
    expect(FakeWorker.latest).toBeUndefined();
    expect(client.getStatus()).toBe('idle');
    client.initialize();
    expect(FakeWorker.latest).toBeDefined();
    expect(FakeWorker.latest!.sent[0]).toMatchObject({ type: 'initialize' });
  });

  it('reuses a single worker across repeated initialize calls', () => {
    const { client, worker } = makeClient();
    client.initialize();
    const first = worker();
    client.initialize();
    expect(worker()).toBe(first);
  });

  it('maps progress, status and ready events into observable state', () => {
    const { client, events, worker } = makeClient();
    client.initialize();
    worker().emit({ type: 'progress', file: 'model_q4f16.onnx', loaded: 50, total: 100, progress: 50 });
    worker().emit({ type: 'status', status: 'loading', detail: 'Downloading model' });
    worker().emit({ type: 'ready', backend: 'webgpu', modelId: 'x/y' });

    // initialize() emits its own optimistic 'status' event before the worker replies.
    expect(events.map((e) => e.type)).toEqual(['status', 'progress', 'status', 'ready']);
    expect(client.getStatus()).toBe('ready');
    expect(client.getBackend()).toBe('webgpu');
  });

  it('streams tokens and resolves a generation on complete', async () => {
    const { client, worker } = makeClient();
    client.initialize();
    worker().emit({ type: 'ready', backend: 'wasm', modelId: 'x/y' });

    const chunks: string[] = [];
    const result = client.generate(
      { requestId: 'r1', messages: [{ role: 'user', content: 'hi' }] },
      (chunk) => chunks.push(chunk),
    );
    worker().emit({ type: 'token', requestId: 'r1', text: 'He' });
    worker().emit({ type: 'token', requestId: 'r1', text: 'llo' });
    worker().emit({ type: 'complete', requestId: 'r1', text: 'Hello' });

    await expect(result).resolves.toEqual({ outcome: 'complete', text: 'Hello' });
    expect(chunks).toEqual(['He', 'llo']);
  });

  it('ignores stray events belonging to a different request id', async () => {
    const { client, worker } = makeClient();
    client.initialize();
    worker().emit({ type: 'ready', backend: 'wasm', modelId: 'x/y' });

    const chunks: string[] = [];
    const result = client.generate({ requestId: 'r2', messages: [] }, (c) => chunks.push(c));
    worker().emit({ type: 'token', requestId: 'stale', text: 'ghost' });
    worker().emit({ type: 'complete', requestId: 'r2', text: 'ok' });

    await expect(result).resolves.toEqual({ outcome: 'complete', text: 'ok' });
    expect(chunks).toEqual([]);
  });

  it('resolves as stopped and keeps the partial text', async () => {
    const { client, worker } = makeClient();
    client.initialize();
    worker().emit({ type: 'ready', backend: 'wasm', modelId: 'x/y' });

    const result = client.generate({ requestId: 'r3', messages: [] }, () => {});
    worker().emit({ type: 'token', requestId: 'r3', text: 'par' });
    client.abort('r3');
    expect(worker().sent.at(-1)).toEqual({ type: 'abort', requestId: 'r3' });
    worker().emit({ type: 'aborted', requestId: 'r3', text: 'par' });

    await expect(result).resolves.toEqual({ outcome: 'stopped', text: 'par' });
  });

  it('resolves as failed with the worker error message and partial text', async () => {
    const { client, worker } = makeClient();
    client.initialize();
    worker().emit({ type: 'ready', backend: 'wasm', modelId: 'x/y' });

    const result = client.generate({ requestId: 'r4', messages: [] }, () => {});
    worker().emit({ type: 'token', requestId: 'r4', text: 'half' });
    worker().emit({ type: 'error', requestId: 'r4', code: 'generation-failed', message: 'boom' });

    await expect(result).resolves.toEqual({ outcome: 'error', text: 'half', error: 'boom' });
  });

  it('surfaces load errors as an error status without killing later retries', async () => {
    const { client, worker } = makeClient();
    client.initialize();
    worker().emit({ type: 'error', code: 'load-failed', message: 'network down' });
    expect(client.getStatus()).toBe('error');
    expect(client.getError()).toBe('network down');

    client.initialize();
    expect(client.getStatus()).toBe('loading');
    expect(client.getError()).toBeUndefined();
  });

  it('rejects generate() before the runtime is ready', async () => {
    const { client } = makeClient();
    await expect(client.generate({ requestId: 'r5', messages: [] }, () => {})).rejects.toThrow(
      /not ready/i,
    );
  });

  it('fails all in-flight generations when the worker crashes', async () => {
    const { client, worker } = makeClient();
    client.initialize();
    worker().emit({ type: 'ready', backend: 'wasm', modelId: 'x/y' });
    const result = client.generate({ requestId: 'r6', messages: [] }, () => {});
    worker().emitCrash('worker died');
    await expect(result).resolves.toMatchObject({ outcome: 'error', error: 'worker died' });
    expect(client.getStatus()).toBe('error');
  });

  it('terminates the worker and resets state on dispose()', () => {
    const { client, worker } = makeClient();
    client.initialize();
    const spawned = worker();
    client.dispose();
    expect(spawned.terminated).toBe(true);
    expect(client.getStatus()).toBe('idle');
  });

  it('notifies unsubscribed listeners no further', () => {
    const { client, worker } = makeClient();
    const seen: WorkerEvent[] = [];
    const off = client.subscribe((e) => seen.push(e));
    client.initialize();
    expect(seen.map((e) => e.type)).toEqual(['status']);
    off();
    worker().emit({ type: 'ready', backend: 'wasm', modelId: 'x/y' });
    expect(seen.map((e) => e.type)).toEqual(['status']);
  });
});

describe('context window policy', () => {
  it('is exercised through the model config module', async () => {
    const { buildPromptMessages, MODEL_CONFIG } = await import('../src/config/model');
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `m${i}`,
    }));
    const prompt = buildPromptMessages(history);
    expect(prompt[0]).toEqual({ role: 'system', content: MODEL_CONFIG.systemPrompt });
    expect(prompt.length).toBe(1 + MODEL_CONFIG.maxHistoryMessages);
    expect(prompt.at(-1)?.content).toBe('m19');
  });

  it('keeps short histories untouched', async () => {
    const { buildPromptMessages } = await import('../src/config/model');
    const prompt = buildPromptMessages([{ role: 'user', content: 'hey' }]);
    expect(prompt.length).toBe(2);
    expect(prompt[1]).toEqual({ role: 'user', content: 'hey' });
  });
});
