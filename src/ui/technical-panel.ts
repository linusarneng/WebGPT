import { getModel, type ModelId } from '../config/model';
import type { Backend, LoadPhase, RuntimeStatus } from '../inference/protocol';
import {
  createBrowserMetricsCollector,
  formatBrowserMetric,
  formatBytes,
  formatDuration,
  formatRate,
  type GenerationStats,
} from '../telemetry/runtime-telemetry';
import { el } from './dom';

export interface TechnicalState {
  selectedId: ModelId;
  loadedId?: ModelId;
  backend?: Backend;
  dtype?: string;
  status: RuntimeStatus;
  phase?: LoadPhase;
  progress?: number;
  error?: string;
  generation: GenerationStats;
}

export interface TechnicalPanelView {
  readonly element: HTMLDetailsElement;
  render(state: TechnicalState): void;
  destroy(): void;
}

const unavailable = 'Not exposed by this browser';

function row(term: string): [HTMLElement, HTMLElement] {
  return [el('dt', { class: 'technical-panel__term' }, [term]), el('dd', { class: 'technical-panel__value' })];
}

/** Honest local instrumentation. It only shows browser APIs that are actually exposed. */
export function createTechnicalPanel(): TechnicalPanelView {
  const collector = createBrowserMetricsCollector();
  const model = el('dl', { class: 'technical-panel__list' });
  const generation = el('div', { class: 'technical-panel__metrics', 'aria-label': 'Generation metrics' });
  const browser = el('dl', { class: 'technical-panel__list' });
  const error = el('p', { class: 'technical-panel__error' });
  const detail = el('details', { class: 'technical-panel__details' }, [
    el('summary', {}, ['Runtime details']),
    error,
  ]) as HTMLDetailsElement;
  const element = el('details', { class: 'technical-panel' }, [
    el('summary', { class: 'technical-panel__summary' }, ['Technical']),
    el('div', { class: 'technical-panel__content' }, [
      el('h3', {}, ['Model / runtime']), model,
      el('h3', {}, ['Generation']), generation,
      el('h3', {}, ['Browser / device']), browser,
      detail,
    ]),
  ]) as HTMLDetailsElement;

  let lastState: TechnicalState | undefined;
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  const sample = (): void => {
    if (lastState) render(lastState);
  };
  const updateSampling = (): void => {
    const active = element.open || lastState?.generation.generating;
    if (active && timer === undefined) timer = globalThis.setInterval(sample, 1_000);
    if (!active && timer !== undefined) {
      globalThis.clearInterval(timer);
      timer = undefined;
    }
  };
  element.addEventListener('toggle', updateSampling);

  function render(state: TechnicalState): void {
    lastState = state;
    const selected = getModel(state.selectedId);
    const loaded = state.loadedId ? getModel(state.loadedId) : undefined;
    const metrics = collector.collect();
    const selectedDtype = state.backend === 'wasm' ? selected.wasmDtype : selected.webgpuDtype;
    const loadedDtype = loaded && state.backend ? (state.backend === 'wasm' ? loaded.wasmDtype : loaded.webgpuDtype) : undefined;

    const modelRows = [
      row('Selected model'), row('Repository ID'), row('Loaded model'), row('Backend'), row('Selected dtype'),
      row('Active dtype'), row('Load phase'), row('Download progress'), row('Runtime state'),
    ];
    const values = [
      selected.name, selected.modelId, loaded?.name ?? 'Not loaded',
      state.backend === 'webgpu' ? 'WebGPU' : state.backend === 'wasm' ? 'CPU / WASM' : 'Not loaded',
      selectedDtype, loadedDtype ?? 'Not known until loaded', state.phase ?? (state.status === 'ready' ? 'ready' : 'idle'),
      state.progress === undefined ? 'No download in progress' : `${Math.round(state.progress)}%`, state.status,
    ];
    for (let index = 0; index < modelRows.length; index += 1) modelRows[index]![1].textContent = values[index]!;
    model.replaceChildren(...modelRows.flat());

    const generationMetrics: Array<[string, string]> = [
      ['Output tokens', state.generation.tokenCount ? String(state.generation.tokenCount) : '—'],
      ['Elapsed', state.generation.tokenCount ? formatDuration(state.generation.elapsedMs) : '—'],
      ['Output rate', state.generation.tokensPerSecond === undefined ? '—' : formatRate(state.generation.tokensPerSecond)],
    ];
    generation.replaceChildren(...generationMetrics.map(([label, value]) => el('div', { class: 'technical-panel__metric' }, [
      el('span', { class: 'technical-panel__metric-label' }, [label]),
      el('strong', { class: 'technical-panel__metric-value' }, [value]),
    ])));

    const browserRows = [row('Secure context'), row('WebGPU exposure'), row('JS heap used'), row('JS heap limit'), row('Device memory'), row('Logical CPU cores'), row('GPU adapter'), row('GPU memory')];
    const browserValues = [
      metrics.secureContext ? 'Secure context' : 'Not a secure context', metrics.webgpu, formatBytes(metrics.heapUsed),
      formatBytes(metrics.heapLimit), metrics.deviceMemory === undefined ? unavailable : `${metrics.deviceMemory} GiB`,
      formatBrowserMetric(metrics.cpuCores), metrics.gpuAdapter,
      'GPU memory is not exposed to normal WebGPU pages.',
    ];
    for (let index = 0; index < browserRows.length; index += 1) browserRows[index]![1].textContent = browserValues[index]!;
    browser.replaceChildren(...browserRows.flat());

    error.textContent = state.error ?? 'No runtime error.';
    detail.hidden = !state.error;
    updateSampling();
  }

  return {
    element,
    render,
    destroy(): void {
      if (timer !== undefined) globalThis.clearInterval(timer);
      element.removeEventListener('toggle', updateSampling);
    },
  };
}
