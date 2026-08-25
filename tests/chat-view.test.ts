import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getModel } from '../src/config/model';
import { createChatView, type ChatViewState, type ChatViewView } from '../src/ui/chat-view';

const callbacks = {
  onStarterPrompt: vi.fn(),
  onLoadModel: vi.fn(),
  onSelectModel: vi.fn(),
  onRetry: vi.fn(),
  onCopy: vi.fn(),
};

let view: ChatViewView;
const text = (): string => view.element.textContent ?? '';
const q = (selector: string): HTMLElement | null => view.element.querySelector(selector);
const all = (selector: string): HTMLElement[] => [...view.element.querySelectorAll<HTMLElement>(selector)];
const render = (state: Partial<ChatViewState> = {}): void =>
  view.render({
    conversation: undefined,
    runtimeStatus: 'idle',
    model: getModel('qwen2.5-0.5b-instruct'),
    selectedId: 'qwen2.5-0.5b-instruct',
    locked: false,
    ...state,
  });

beforeEach(() => {
  vi.clearAllMocks();
  view = createChatView(callbacks);
  document.body.replaceChildren(view.element);
});

describe('first-run install plate', () => {
  it('states the product, the exact model and that it runs in this browser', () => {
    render();
    const plate = q('.plate')!;
    const plateText = plate.textContent ?? '';
    expect(plateText).toContain('WebGPT');
    expect(plateText).toContain('Qwen2.5 0.5B Instruct');
    expect(plateText.toLowerCase()).toContain('in this browser');
  });

  it('says no account, key or server is involved', () => {
    render();
    expect(text().toLowerCase()).toMatch(/no api key|no account|no server/);
  });

  it('uses only the approximate size from config, never an invented exact size', () => {
    render();
    const plateText = q('.plate')!.textContent ?? '';
    expect(plateText).toContain(String(getModel('qwen2.5-0.5b-instruct').approximateDownloadMb));
    expect(plateText.toLowerCase()).toContain('about');
    expect(plateText.toLowerCase()).toContain('cach');
  });

  it('offers a prominent Load model action while idle', () => {
    render();
    const load = q('.plate__cta') as HTMLButtonElement;
    expect(load.textContent).toContain('Load');
    load.click();
    expect(callbacks.onLoadModel).toHaveBeenCalledOnce();
  });

  it('keeps starter prompts available next to the plate', () => {
    render();
    expect(all('.starter')).toHaveLength(4);
    all('.starter')[0]!.click();
    expect(callbacks.onStarterPrompt).toHaveBeenCalledOnce();
  });
});

describe('load phases in the empty state', () => {
  it('walks four named phases with done, active and pending steps', () => {
    render({ runtimeStatus: 'loading', runtimePhase: 'downloading' });
    const steps = all('.phase');
    expect(steps.map((step) => step.textContent)).toEqual([
      'Checking device',
      'Downloading model',
      'Preparing model',
      'Ready',
    ]);
    expect(steps.map((step) => step.dataset.state)).toEqual(['done', 'active', 'pending', 'pending']);
  });

  it('advances the rail as the phase advances', () => {
    render({ runtimeStatus: 'loading', runtimePhase: 'preparing' });
    expect(all('.phase').map((step) => step.dataset.state)).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
  });

  it('shows the real download percentage and hides the CTA while loading', () => {
    render({ runtimeStatus: 'loading', runtimePhase: 'downloading', runtimePercent: 37.6 });
    expect(q('.plate__meter')!.getAttribute('aria-valuenow')).toBe('38');
    expect(q('.plate__cta')).toBeNull();
  });

  it('omits the meter when there is no measured progress', () => {
    render({ runtimeStatus: 'loading', runtimePhase: 'checking' });
    expect(q('.plate__meter')).toBeNull();
  });

  it('drops the plate entirely once the model is ready', () => {
    render({ runtimeStatus: 'ready' });
    expect(q('.plate')).toBeNull();
    expect(all('.starter')).toHaveLength(4);
  });
});

describe('failure and fallback', () => {
  it('explains a failed load calmly and keeps the raw cause behind a details affordance', () => {
    render({ runtimeStatus: 'error', runtimeError: 'network gone' });
    const notice = q('.notice--error')!;
    const details = notice.querySelector('details')!;
    expect(details.querySelector('summary')!.textContent).toBe('Technical details');
    expect(details.textContent).toContain('network gone');
    expect(notice.querySelector('.notice__action')!.textContent).toBe('Try loading again');
  });

  it('states the CPU fallback in one calm line once ready', () => {
    render({ runtimeStatus: 'ready', runtimeWarning: 'WebGPU is unavailable' });
    const warn = q('.notice--warn')!;
    expect(warn.textContent).toContain('WebGPU is unavailable');
    expect(warn.classList.contains('notice--error')).toBe(false);
  });

  it('does not show the fallback warning while the model is still loading', () => {
    render({ runtimeStatus: 'loading', runtimePhase: 'preparing', runtimeWarning: 'WebGPU is unavailable' });
    expect(q('.notice--warn')).toBeNull();
  });
});

describe('choosing a model from the first-run card', () => {
  it('puts the picker in the card, on the selected model', () => {
    render();
    const checked = q('.plate .model-option__input:checked') as HTMLInputElement;
    expect(checked.value).toBe('qwen2.5-0.5b-instruct');
    expect(all('.plate .model-option')).toHaveLength(3);
  });

  it('reports a different choice without loading anything', () => {
    render();
    (q('.plate input[value="qwen3-0.6b"]') as HTMLInputElement).click();
    expect(callbacks.onSelectModel).toHaveBeenCalledWith('qwen3-0.6b');
    expect(callbacks.onLoadModel).not.toHaveBeenCalled();
  });

  it('names the selected model in the heading, the size and the load action', () => {
    render({ model: getModel('granite-4.0-350m'), selectedId: 'granite-4.0-350m' });
    const plate = q('.plate')!.textContent ?? '';
    expect(plate).toContain('Granite 4.0 350M');
    expect(plate).toContain('360');
    expect(q('.plate__cta')!.textContent).toContain('Load Granite 4.0 350M');
  });

  it('keeps the picker visible while loading, but locked', () => {
    render({ runtimeStatus: 'loading', runtimePhase: 'downloading', locked: true, lockReason: 'Loading.' });
    expect(all('.plate .model-option')).toHaveLength(3);
    expect(all('.plate .model-option__input').every((i) => (i as HTMLInputElement).disabled)).toBe(true);
  });

  it('explains that weights are cached locally, not uploaded', () => {
    render();
    const plate = (q('.plate')!.textContent ?? '').toLowerCase();
    expect(plate).toContain('cached in this browser');
    expect(plate).toContain('never leave this device');
  });
});
