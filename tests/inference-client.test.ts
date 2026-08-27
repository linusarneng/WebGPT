import { getModel } from '../src/config/model';
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
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    expect(FakeWorker.latest).toBeDefined();
    expect(FakeWorker.latest!.sent[0]).toMatchObject({ type: 'initialize', model: { id: 'qwen2.5-0.5b-instruct' } });
  });

  it('reuses a single worker across repeated initialize calls', () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    const first = worker();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    expect(worker()).toBe(first);
  });

  it('maps progress, status and ready events into observable state', () => {
    const { client, events, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'progress', file: 'model_q4f16.onnx', loaded: 50, total: 100, progress: 50 });
    worker().emit({ type: 'status', status: 'loading', detail: 'Downloading model' });
    worker().emit({ type: 'ready', backend: 'webgpu', model: 'qwen2.5-0.5b-instruct' });

    // initialize() emits its own optimistic 'status' event before the worker replies.
    expect(events.map((e) => e.type)).toEqual(['status', 'progress', 'status', 'ready']);
    expect(client.getStatus()).toBe('ready');
    expect(client.getBackend()).toBe('webgpu');
  });

  it('streams tokens and resolves a generation on complete', async () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'ready', backend: 'wasm', model: 'qwen2.5-0.5b-instruct' });

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
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'ready', backend: 'wasm', model: 'qwen2.5-0.5b-instruct' });

    const chunks: string[] = [];
    const result = client.generate({ requestId: 'r2', messages: [] }, (c) => chunks.push(c));
    worker().emit({ type: 'token', requestId: 'stale', text: 'ghost' });
    worker().emit({ type: 'complete', requestId: 'r2', text: 'ok' });

    await expect(result).resolves.toEqual({ outcome: 'complete', text: 'ok' });
    expect(chunks).toEqual([]);
  });

  it('resolves as stopped and keeps the partial text', async () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'ready', backend: 'wasm', model: 'qwen2.5-0.5b-instruct' });

    const result = client.generate({ requestId: 'r3', messages: [] }, () => {});
    worker().emit({ type: 'token', requestId: 'r3', text: 'par' });
    client.abort('r3');
    expect(worker().sent.at(-1)).toEqual({ type: 'abort', requestId: 'r3' });
    worker().emit({ type: 'aborted', requestId: 'r3', text: 'par' });

    await expect(result).resolves.toEqual({ outcome: 'stopped', text: 'par' });
  });

  it('resolves as failed with the worker error message and partial text', async () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'ready', backend: 'wasm', model: 'qwen2.5-0.5b-instruct' });

    const result = client.generate({ requestId: 'r4', messages: [] }, () => {});
    worker().emit({ type: 'token', requestId: 'r4', text: 'half' });
    worker().emit({ type: 'error', requestId: 'r4', code: 'generation-failed', message: 'boom' });

    await expect(result).resolves.toEqual({ outcome: 'error', text: 'half', error: 'boom' });
  });

  it('surfaces load errors as an error status without killing later retries', async () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'error', code: 'load-failed', message: 'network down' });
    expect(client.getStatus()).toBe('error');
    expect(client.getError()).toBe('network down');

    client.initialize(getModel('qwen2.5-0.5b-instruct'));
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
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'ready', backend: 'wasm', model: 'qwen2.5-0.5b-instruct' });
    const result = client.generate({ requestId: 'r6', messages: [] }, () => {});
    worker().emitCrash('worker died');
    await expect(result).resolves.toMatchObject({ outcome: 'error', error: 'worker died' });
    expect(client.getStatus()).toBe('error');
  });

  it('terminates the worker and resets state on dispose()', () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    const spawned = worker();
    client.dispose();
    expect(spawned.terminated).toBe(true);
    expect(client.getStatus()).toBe('idle');
  });

  it('notifies unsubscribed listeners no further', () => {
    const { client, worker } = makeClient();
    const seen: WorkerEvent[] = [];
    const off = client.subscribe((e) => seen.push(e));
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    expect(seen.map((e) => e.type)).toEqual(['status']);
    off();
    worker().emit({ type: 'ready', backend: 'wasm', model: 'qwen2.5-0.5b-instruct' });
    expect(seen.map((e) => e.type)).toEqual(['status']);
  });
});

describe('InferenceClient model selection', () => {
  beforeEach(() => {
    FakeWorker.latest = undefined;
  });

  it('tells the worker which model to load', () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('qwen3-0.6b'));
    expect(worker().sent[0]).toEqual({ type: 'initialize', model: getModel('qwen3-0.6b') });
  });

  it('reports the model the worker actually loaded', () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('granite-4.0-350m'));
    expect(client.getLoadedModel()).toBeUndefined();
    worker().emit({ type: 'ready', backend: 'webgpu', model: 'granite-4.0-350m' });
    expect(client.getLoadedModel()).toBe('granite-4.0-350m');
  });

  it('tears the worker down on reset so the next model starts clean', () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'ready', backend: 'webgpu', model: 'qwen2.5-0.5b-instruct' });
    const first = worker();

    client.reset();
    expect(first.terminated).toBe(true);
    expect(client.getStatus()).toBe('idle');
    expect(client.getLoadedModel()).toBeUndefined();
    expect(client.getBackend()).toBeUndefined();

    client.initialize(getModel('qwen3-0.6b'));
    expect(worker()).not.toBe(first);
    expect(worker().sent).toEqual([{ type: 'initialize', model: getModel('qwen3-0.6b') }]);
  });

  it('announces the reset so the UI can fall back to the idle state', () => {
    const { client, events, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'ready', backend: 'webgpu', model: 'qwen2.5-0.5b-instruct' });
    events.length = 0;
    client.reset();
    expect(events).toEqual([{ type: 'status', status: 'idle' }]);
  });

  it('drops a stale warning from the previous model', () => {
    const { client, worker } = makeClient();
    client.initialize(getModel('qwen2.5-0.5b-instruct'));
    worker().emit({ type: 'ready', backend: 'wasm', model: 'qwen2.5-0.5b-instruct', warning: 'slow' });
    expect(client.getWarning()).toBe('slow');
    client.reset();
    expect(client.getWarning()).toBeUndefined();
  });
});
