import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MODEL_CATALOG } from '../src/config/model';
import { createTechnicalPanel, type TechnicalPanelView, type TechnicalState } from '../src/ui/technical-panel';

let panel: TechnicalPanelView;
const q = (selector: string): HTMLElement | null => panel.element.querySelector(selector);
const text = (): string => panel.element.textContent ?? '';

const idleGeneration = { tokenCount: 0, elapsedMs: 0, tokensPerSecond: undefined, generating: false };
const render = (state: Partial<TechnicalState> = {}): void =>
  panel.render({
    models: MODEL_CATALOG,
    selectedId: 'qwen2.5-0.5b-instruct',
    status: 'idle',
    generation: idleGeneration,
    ...state,
  });

beforeEach(() => {
  panel = createTechnicalPanel();
  document.body.replaceChildren(panel.element);
});
afterEach(() => panel.destroy());

describe('permanent technical panel', () => {
  it('is a always-visible panel, not a disclosure or dropdown', () => {
    render();
    expect(panel.element.tagName).not.toBe('DETAILS');
    expect(panel.element.querySelector('details')).toBeNull();
    expect(panel.element.querySelector('summary')).toBeNull();
  });

  it('shows runtime status, the selected model and that nothing is loaded yet', () => {
    render();
    expect(q('.technical-panel__status')!.dataset.state).toBe('idle');
    expect(text()).toContain('Qwen2.5 0.5B Instruct');
    expect(text()).toContain('Not loaded');
  });

  it('names the real backend once a model is loaded', () => {
    render({ status: 'ready', loadedId: 'qwen2.5-0.5b-instruct', backend: 'webgpu' });
    expect(q('.technical-panel__status')!.dataset.state).toBe('ready');
    expect(text()).toContain('WebGPU');
  });

  it('reports the measured CPU fallback rather than assuming WebGPU', () => {
    render({ status: 'ready', loadedId: 'qwen2.5-0.5b-instruct', backend: 'wasm' });
    expect(text()).toContain('CPU / WASM');
  });

  it('shows the current load phase and measured progress while loading', () => {
    render({ status: 'loading', phase: 'downloading', progress: 42 });
    expect(q('.technical-panel__status')!.dataset.state).toBe('loading');
    expect(text()).toContain('downloading');
    expect(text()).toContain('42%');
  });

  it('shows real response metrics once tokens have been counted', () => {
    render({
      status: 'ready',
      loadedId: 'qwen2.5-0.5b-instruct',
      backend: 'webgpu',
      generation: { tokenCount: 24, elapsedMs: 2_000, tokensPerSecond: 12, generating: true },
    });
    expect(q('.technical-panel__status')!.dataset.state).toBe('generating');
    const metrics = [...panel.element.querySelectorAll('.technical-panel__metric')];
    expect(metrics).toHaveLength(3);
    expect(text()).toContain('24');
    expect(text()).toContain('12');
  });

  it('invents no metric values before any generation', () => {
    render();
    const values = [...panel.element.querySelectorAll('.technical-panel__metric-value')].map((n) => n.textContent);
    expect(values.every((value) => value === '—')).toBe(true);
  });

  it('surfaces an error as one concise line, and hides it otherwise', () => {
    render();
    expect(q('.technical-panel__error')!.hidden).toBe(true);
    render({ status: 'error', error: 'Mock download failed.' });
    const error = q('.technical-panel__error')!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain('Mock download failed.');
  });

  it('has no independently scrolling region', () => {
    render();
    const scrollers = [panel.element, ...panel.element.querySelectorAll<HTMLElement>('*')].filter((node) =>
      (node.getAttribute('style') ?? '').includes('overflow'),
    );
    expect(scrollers).toEqual([]);
  });
});

describe('technical panel with a custom model', () => {
  const CUSTOM = {
    id: 'custom:owner/name',
    modelId: 'owner/name',
    name: 'name',
    tradeoff: 'Added by you',
    summary: 'Added by you.',
    webgpuDtype: 'q4f16',
    wasmDtype: 'q4',
    approximateDownloadMb: 260,
    custom: true,
  } as const;

  it('names the user’s own model rather than falling back to the default', () => {
    render({ models: [...MODEL_CATALOG, CUSTOM], selectedId: CUSTOM.id, status: 'idle' });
    expect(panel.element.textContent).toContain('name');
    expect(panel.element.textContent).not.toContain(MODEL_CATALOG[0]!.name);
  });
});
