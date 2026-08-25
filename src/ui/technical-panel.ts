import { getModel, type ModelId } from '../config/model';
import type { Backend, LoadPhase, RuntimeStatus } from '../inference/protocol';
import {
  createBrowserMetricsCollector,
  createSparklineModel,
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
const historyLimit = 24;

type VisualState = RuntimeStatus | 'generating';

function row(term: string): [HTMLElement, HTMLElement] {
  return [el('dt', { class: 'technical-panel__term' }, [term]), el('dd', { class: 'technical-panel__value' })];
}

function record(history: number[], value: number | undefined): void {
  if (value === undefined || !Number.isFinite(value)) return;
  history.push(value);
  if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
}

function visualStatus(state: TechnicalState): VisualState {
  if (state.status === 'error') return 'error';
  return state.generation.generating ? 'generating' : state.status;
}

function statusLabel(status: VisualState): string {
  return status[0]!.toUpperCase() + status.slice(1);
}

function sparkline(label: string, values: readonly number[] | undefined, emptyText: string, unavailableText: string): HTMLElement {
  const model = createSparklineModel(values);
  const text = model.state === 'data'
    ? `${label}: ${model.valueCount} observed sample${model.valueCount === 1 ? '' : 's'}.`
    : model.state === 'empty' ? `${label}: ${emptyText}` : `${label}: ${unavailableText}`;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'technical-panel__sparkline-path');
  path.setAttribute('d', model.path);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'technical-panel__sparkline');
  svg.setAttribute('viewBox', '0 0 100 24');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  if (model.state === 'data') svg.append(path);
  return el('div', { class: 'technical-panel__chart', 'data-state': model.state }, [
    svg,
    el('span', { class: 'visually-hidden' }, [text]),
    el('span', { class: 'technical-panel__chart-caption' }, [model.state === 'data' ? `${model.valueCount} samples` : model.state === 'empty' ? emptyText : unavailableText]),
  ]);
}

/** Honest local instrumentation. It only shows browser APIs that are actually exposed. */
export function createTechnicalPanel(): TechnicalPanelView {
  const collector = createBrowserMetricsCollector();
  const model = el('dl', { class: 'technical-panel__list' });
  const status = el('div', { class: 'technical-panel__status' });
  const generation = el('div', { class: 'technical-panel__metrics', 'aria-label': 'Generation metrics' });
  const browser = el('dl', { class: 'technical-panel__list' });
  const memoryVisual = el('div', { class: 'technical-panel__memory', 'aria-label': 'Browser memory history' });
  const error = el('p', { class: 'technical-panel__error' });
  const detail = el('details', { class: 'technical-panel__details' }, [
    el('summary', {}, ['Runtime details']),
    error,
  ]) as HTMLDetailsElement;
  const element = el('details', { class: 'technical-panel' }, [
    el('summary', { class: 'technical-panel__summary' }, ['Technical']),
    el('div', { class: 'technical-panel__content' }, [
      el('h3', {}, ['Model / runtime']), status, model,
      el('h3', {}, ['Generation']), generation,
      el('h3', {}, ['Browser / device']), memoryVisual, browser,
      detail,
    ]),
  ]) as HTMLDetailsElement;

  const rateHistory: number[] = [];
  const heapHistory: number[] = [];
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
  const onToggle = (): void => {
    updateSampling();
    if (element.open) sample();
  };
  element.addEventListener('toggle', onToggle);

  function render(state: TechnicalState): void {
    lastState = state;
    const selected = getModel(state.selectedId);
    const loaded = state.loadedId ? getModel(state.loadedId) : undefined;
    const metrics = collector.collect();
    if (state.generation.generating) record(rateHistory, state.generation.tokensPerSecond);
    if (element.open) record(heapHistory, metrics.heapUsed);
    const selectedDtype = state.backend === 'wasm' ? selected.wasmDtype : selected.webgpuDtype;
    const loadedDtype = loaded && state.backend ? (state.backend === 'wasm' ? loaded.wasmDtype : loaded.webgpuDtype) : undefined;
    const runtimeStatus = visualStatus(state);

    status.replaceChildren(
      el('span', { class: 'technical-panel__status-dot', 'aria-hidden': 'true' }),
      el('span', { class: 'technical-panel__status-label' }, [statusLabel(runtimeStatus)]),
    );
    status.dataset.state = runtimeStatus;
    status.setAttribute('aria-label', `Runtime status: ${statusLabel(runtimeStatus)}`);

    const modelRows = [
      row('Selected model'), row('Repository ID'), row('Loaded model'), row('Backend'), row('Selected dtype'),
      row('Active dtype'), row('Load phase'), row('Download progress'), row('Runtime state'),
    ];
    const values = [
      selected.name, selected.modelId, loaded?.name ?? 'Not loaded',
      state.backend === 'webgpu' ? 'WebGPU' : state.backend === 'wasm' ? 'CPU / WASM' : 'Not loaded',
      selectedDtype, loadedDtype ?? 'Not known until loaded', state.phase ?? (state.status === 'ready' ? 'ready' : 'idle'),
      state.progress === undefined ? 'No download in progress' : `${Math.round(state.progress)}%`, statusLabel(runtimeStatus),
    ];
    for (let index = 0; index < modelRows.length; index += 1) modelRows[index]![1].textContent = values[index]!;
    model.replaceChildren(...modelRows.flat());

    generation.replaceChildren(
      el('div', { class: 'technical-panel__metric' }, [
        el('span', { class: 'technical-panel__metric-label' }, ['Output tokens']),
        el('strong', { class: 'technical-panel__metric-value' }, [state.generation.tokenCount ? String(state.generation.tokenCount) : '—']),
      ]),
      el('div', { class: 'technical-panel__metric' }, [
        el('span', { class: 'technical-panel__metric-label' }, ['Elapsed']),
        el('strong', { class: 'technical-panel__metric-value' }, [state.generation.tokenCount ? formatDuration(state.generation.elapsedMs) : '—']),
      ]),
      el('div', { class: 'technical-panel__metric technical-panel__metric--rate' }, [
        el('span', { class: 'technical-panel__metric-label' }, ['Output rate']),
        el('strong', { class: 'technical-panel__metric-value' }, [formatRate(state.generation.tokensPerSecond)]),
        sparkline('Output-rate history', rateHistory, 'Waiting for real generation samples', unavailable),
      ]),
    );

    memoryVisual.replaceChildren(
      el('div', { class: 'technical-panel__memory-head' }, [
        el('span', { class: 'technical-panel__memory-label' }, ['Browser memory']),
        el('strong', { class: 'technical-panel__memory-value' }, [formatBytes(metrics.heapUsed)]),
      ]),
      sparkline('Browser memory history', metrics.heapUsed === undefined ? undefined : heapHistory, 'Collecting first heap observation', unavailable),
    );

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
      element.removeEventListener('toggle', onToggle);
    },
  };
}
