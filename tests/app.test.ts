import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app';
import { MemoryChatRepository } from '../src/storage/chat-repository';
import type { WorkerCommand, WorkerEvent } from '../src/inference/protocol';
import { MODEL_PREFERENCE_KEY } from '../src/storage/model-preference';
import { getDefaultModel, MODEL_CATALOG } from '../src/config/model';

const DEFAULT_MODEL = getDefaultModel();
const OTHER_MODEL = MODEL_CATALOG.find((model) => model.id !== DEFAULT_MODEL.id)!;

/** A scriptable stand-in for the Transformers.js worker. */
class ScriptedWorker extends EventTarget {
  static latest: ScriptedWorker | undefined;
  readonly commands: WorkerCommand[] = [];
  terminated = false;

  constructor() {
    super();
    ScriptedWorker.latest = this;
  }
  postMessage(command: WorkerCommand): void {
    this.commands.push(command);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(event: WorkerEvent): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data: event }));
  }
  lastGenerateId(): string {
    const generate = [...this.commands].reverse().find((c) => c.type === 'generate');
    if (!generate || generate.type !== 'generate') throw new Error('no generate command sent');
    return generate.requestId;
  }
  becomeReady(model = DEFAULT_MODEL.id): void {
    this.emit({ type: 'ready', backend: 'webgpu', model });
  }
  lastInitialize(): WorkerCommand & { type: 'initialize' } {
    const command = [...this.commands].reverse().find((c) => c.type === 'initialize');
    if (!command || command.type !== 'initialize') throw new Error('no initialize command sent');
    return command;
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function q<T extends Element>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}
function all(selector: string): Element[] {
  return [...document.body.querySelectorAll(selector)];
}
/** The plate's load action, which is labelled with the selected model. */
function loadButton(): HTMLButtonElement | undefined {
  return all('.plate__cta')[0] as HTMLButtonElement | undefined;
}
/** The radio row for one catalog model inside the first-run card. */
function modelOption(id: string): HTMLInputElement {
  return document.body.querySelector<HTMLInputElement>(
    `.plate .model-option__input[value="${id}"], .model-menu .model-option__input[value="${id}"]`,
  )!;
}
function chooseModel(id: string): void {
  const input = modelOption(id);
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function byText(selector: string, text: string): HTMLElement | undefined {
  return all(selector).find((n) => n.textContent?.trim() === text) as HTMLElement | undefined;
}

let app: App;
let root: HTMLElement;

async function mount(): Promise<void> {
  root = document.createElement('div');
  document.body.append(root);
  app = await createApp({
    root,
    repository: repo,
    workerFactory: () => new ScriptedWorker() as unknown as Worker,
  });
  await flush();
}

let repo: MemoryChatRepository;

beforeEach(() => {
  localStorage.clear();
  repo = new MemoryChatRepository();
  ScriptedWorker.latest = undefined;
});

afterEach(() => {
  app?.destroy();
  root?.remove();
});

describe('WebGPT app', () => {
  it('renders the empty state with starter prompts and a load action', async () => {
    await mount();
    expect(q('.plate__title')).not.toBeNull();
    expect(q('.plate__title')!.textContent).toContain(DEFAULT_MODEL.name);
    expect(q('.status__label')!.textContent).toContain(`${DEFAULT_MODEL.name} · not loaded`);
    expect(all('.starter')).toHaveLength(4);
    expect(loadButton()).toBeDefined();
    expect(ScriptedWorker.latest).toBeUndefined();
  });

  it('uses the default before loading, then persists a switch until the user explicitly loads it', async () => {
    await mount();
    expect(q('.plate__title')!.textContent).toContain(DEFAULT_MODEL.name);

    loadButton()!.click();
    const firstWorker = ScriptedWorker.latest!;
    firstWorker.becomeReady();
    await flush();

    chooseModel(OTHER_MODEL.id);
    await flush();
    expect(firstWorker.terminated).toBe(true);
    expect(localStorage.getItem(MODEL_PREFERENCE_KEY)).toBe(OTHER_MODEL.id);
    expect(q('.plate__title')!.textContent).toContain(OTHER_MODEL.name);
    expect(q<HTMLTextAreaElement>('.composer__input')!.disabled).toBe(true);
    expect(ScriptedWorker.latest).toBe(firstWorker);

    loadButton()!.click();
    expect(ScriptedWorker.latest).not.toBe(firstWorker);
    expect(ScriptedWorker.latest!.lastInitialize().model).toBe(OTHER_MODEL.id);
    ScriptedWorker.latest!.becomeReady(OTHER_MODEL.id);
    await flush();
    expect(q('.model-menu__toggle')!.textContent).toContain(OTHER_MODEL.name);

    app.destroy();
    root.remove();
    await mount();
    expect(q('.plate__title')!.textContent).toContain(OTHER_MODEL.name);
  });

  it('keeps the composer disabled until the runtime reports ready', async () => {
    await mount();
    const input = q<HTMLTextAreaElement>('.composer__input')!;
    expect(input.disabled).toBe(true);

    loadButton()!.click();
    await flush();
    expect(ScriptedWorker.latest!.commands[0]).toMatchObject({ type: 'initialize' });
    expect(q('.status')!.getAttribute('data-state')).toBe('loading');

    ScriptedWorker.latest!.becomeReady();
    await flush();
    expect(input.disabled).toBe(false);
    expect(q('.status__label')!.textContent).toContain('WebGPU');
  });

  it('shows aggregated download progress while files load', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.emit({ type: 'progress', file: 'a.onnx', loaded: 25, total: 100 });
    ScriptedWorker.latest!.emit({ type: 'progress', file: 'b.onnx', loaded: 75, total: 100 });
    await flush();
    expect(q('.status__label')!.textContent).toContain('50%');
    expect(q('.status__bar')).not.toBeNull();
  });

  it('keeps runtime facts in a permanent, always-visible sidebar panel', async () => {
    await mount();
    const technical = q('.technical-panel')!;
    expect(technical).not.toBeNull();
    expect(technical.tagName).toBe('SECTION');
    expect(technical.querySelector('summary')).toBeNull();
    expect(technical.textContent).toContain(DEFAULT_MODEL.name);
    expect(technical.textContent).toContain('Not loaded');
    expect(all('.technical-panel__metric')).toHaveLength(3);

    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();
    expect(technical.textContent).toContain('WebGPU');
    expect(q<HTMLElement>('.technical-panel__status')!.dataset.state).toBe('ready');
  });

  it('moves conversation history into a collapsed disclosure below the runtime panel', async () => {
    await mount();
    const history = q<HTMLDetailsElement>('.history')!;
    expect(history.tagName).toBe('DETAILS');
    expect(history.open).toBe(false);
    expect(history.textContent).toContain('History');
    expect(history.querySelector('.chat-list')).not.toBeNull();
    expect(q('.new-chat')!.closest('.history')).toBeNull();
  });

  it('streams a reply into the conversation and renders it safely', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();

    const input = q<HTMLTextAreaElement>('.composer__input')!;
    input.value = 'Hello there';
    q('.composer')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(all('.message')).toHaveLength(2);
    expect(q('.message--user')!.textContent).toContain('Hello there');

    const worker = ScriptedWorker.latest!;
    const requestId = worker.lastGenerateId();
    worker.emit({ type: 'token', requestId, text: 'Hi <b>there</b>' });
    await flush();
    expect(q<HTMLElement>('.message--assistant')!.dataset.status).toBe('streaming');
    expect(q('.message--assistant b')).toBeNull();
    expect(q('.message--assistant')!.textContent).toContain('Hi <b>there</b>');

    worker.emit({ type: 'complete', requestId, text: 'Hi <b>there</b>' });
    await flush();
    expect(q<HTMLElement>('.message--assistant')!.dataset.status).toBe('done');
    expect(byText('button', 'Copy')).toBeDefined();
  });

  it('sends only the trimmed text and clears the composer', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();
    const input = q<HTMLTextAreaElement>('.composer__input')!;
    input.value = '   spaced out   ';
    q('.composer')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(input.value).toBe('');
    expect(q('.message--user')!.textContent).toContain('spaced out');
  });

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();

    const input = q<HTMLTextAreaElement>('.composer__input')!;
    input.value = 'line one';
    const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true, bubbles: true });
    input.dispatchEvent(shiftEnter);
    await flush();
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(all('.message')).toHaveLength(0);

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(enter);
    await flush();
    expect(enter.defaultPrevented).toBe(true);
    expect(all('.message')).toHaveLength(2);
  });

  it('turns Send into Stop while generating and keeps the partial reply', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();

    const input = q<HTMLTextAreaElement>('.composer__input')!;
    input.value = 'long answer please';
    q('.composer')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    const worker = ScriptedWorker.latest!;
    const requestId = worker.lastGenerateId();
    worker.emit({ type: 'token', requestId, text: 'partial ' });
    await flush();

    const action = q<HTMLButtonElement>('.composer__send')!;
    expect(q<HTMLElement>('.composer')!.dataset.state).toBe('generating');
    expect(action.getAttribute('aria-label')).toBe('Stop generating the response');
    action.click();
    await flush();
    expect(worker.commands.at(-1)).toEqual({ type: 'abort', requestId });

    worker.emit({ type: 'aborted', requestId, text: 'partial ' });
    await flush();
    expect(q<HTMLElement>('.message--assistant')!.dataset.status).toBe('stopped');
    expect(q('.message--assistant')!.textContent).toContain('partial');
    expect(q<HTMLElement>('.composer')!.dataset.state).toBe('ready');
    expect(q('.composer__send')!.getAttribute('aria-label')).toBe('Send message');
  });

  it('offers retry after a generation error and reuses the same prompt', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();

    const input = q<HTMLTextAreaElement>('.composer__input')!;
    input.value = 'break please';
    q('.composer')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    const worker = ScriptedWorker.latest!;
    worker.emit({
      type: 'error',
      requestId: worker.lastGenerateId(),
      code: 'generation-failed',
      message: 'out of memory',
    });
    await flush();

    expect(q('.message__note--error')!.textContent).toContain('out of memory');
    expect(q('.message--user')!.textContent).toContain('break please');

    byText('button', 'Retry')!.click();
    await flush();
    const retryId = worker.lastGenerateId();
    worker.emit({ type: 'complete', requestId: retryId, text: 'recovered' });
    await flush();
    expect(q('.message--assistant')!.textContent).toContain('recovered');
    expect(all('.message')).toHaveLength(2);
  });

  it('shows a recoverable error state when the model fails to load', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.emit({ type: 'error', code: 'load-failed', message: 'network gone' });
    await flush();
    expect(q('.status')!.getAttribute('data-state')).toBe('error');
    expect(q('.notice--error')!.textContent).toContain('network gone');
    expect(byText('button', 'Try loading again')).toBeDefined();
  });

  it('warns honestly when it falls back to the CPU backend', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.emit({
      type: 'ready',
      backend: 'wasm',
      model: DEFAULT_MODEL.id,
      warning: 'WebGPU is unavailable, so WebGPT is running on the CPU (WASM).',
    });
    await flush();
    expect(q('.status__label')!.textContent).toContain('CPU / WASM');
    expect(q('.notice--warn')!.textContent).toContain('WebGPU is unavailable');
  });

  it('creates, lists and renames conversations in the sidebar', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();

    const input = q<HTMLTextAreaElement>('.composer__input')!;
    input.value = 'first conversation topic';
    q('.composer')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(q('.chat-item__title')!.textContent).toBe('first conversation topic');

    q<HTMLButtonElement>('.new-chat')!.click();
    await flush();
    expect(all('.chat-item')).toHaveLength(2);

    const rename = all('.chat-item')[1]!.querySelector<HTMLButtonElement>('.chat-item__action')!;
    rename.click();
    await flush();
    const field = q<HTMLInputElement>('.chat-item__rename-input')!;
    field.value = 'Renamed by hand';
    field.form!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(all('.chat-item__title')[1]!.textContent).toBe('Renamed by hand');
  });

  it('restores conversations from the repository across a remount', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();

    const input = q<HTMLTextAreaElement>('.composer__input')!;
    input.value = 'remember me';
    q('.composer')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    const worker = ScriptedWorker.latest!;
    worker.emit({ type: 'complete', requestId: worker.lastGenerateId(), text: 'stored reply' });
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 500));

    app.destroy();
    root.remove();
    await mount();

    expect(q('.message--user')!.textContent).toContain('remember me');
    expect(q('.message--assistant')!.textContent).toContain('stored reply');
  });

  it('does not render tokens from another chat into the visible conversation', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();

    const input = q<HTMLTextAreaElement>('.composer__input')!;
    input.value = 'background question';
    q('.composer')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    q<HTMLButtonElement>('.new-chat')!.click();
    await flush();
    expect(all('.message')).toHaveLength(0);

    const worker = ScriptedWorker.latest!;
    const requestId = worker.lastGenerateId();
    worker.emit({ type: 'token', requestId, text: 'answer for the other chat' });
    worker.emit({ type: 'complete', requestId, text: 'answer for the other chat' });
    await flush();

    expect(document.body.textContent).not.toContain('answer for the other chat');
    (all('.chat-item__select')[1] as HTMLElement).click();
    await flush();
    expect(q('.message--assistant')!.textContent).toContain('answer for the other chat');
  });

  it('blocks a second send while a generation is in flight', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();

    const form = q('.composer')!;
    const input = q<HTMLTextAreaElement>('.composer__input')!;
    input.value = 'first';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    input.value = 'second';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(all('.message')).toHaveLength(2);
    expect(ScriptedWorker.latest!.commands.filter((c) => c.type === 'generate')).toHaveLength(1);
  });

  it('fills the composer from a starter prompt when the model is not loaded yet', async () => {
    await mount();
    all('.starter')[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(q<HTMLTextAreaElement>('.composer__input')!.value).toContain('sky');
    expect(ScriptedWorker.latest!.commands[0]).toMatchObject({ type: 'initialize' });
  });

  it('sends a starter prompt directly once the model is ready', async () => {
    await mount();
    loadButton()!.click();
    ScriptedWorker.latest!.becomeReady();
    await flush();
    all('.starter')[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(all('.message')).toHaveLength(2);
    expect(q('.message--user')!.textContent).toContain('sky');
  });
});
