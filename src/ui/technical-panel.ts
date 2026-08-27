import { getDefaultModel, type ModelConfig, type ModelId } from '../config/model';
import type { Backend, LoadPhase, RuntimeStatus } from '../inference/protocol';
import { formatDuration, type GenerationStats } from '../telemetry/runtime-telemetry';
import { el } from './dom';

export interface TechnicalState {
  /** Every choosable model, so custom ones resolve to their own names. */
  models: readonly ModelConfig[];
  selectedId: ModelId;
  loadedId?: ModelId;
  backend?: Backend;
  status: RuntimeStatus;
  phase?: LoadPhase;
  progress?: number;
  error?: string;
  generation: GenerationStats;
}

export interface TechnicalPanelView {
  readonly element: HTMLElement;
  render(state: TechnicalState): void;
  destroy(): void;
}

type VisualState = RuntimeStatus | 'generating';

function visualStatus(state: TechnicalState): VisualState {
  if (state.status === 'error') return 'error';
  return state.generation.generating ? 'generating' : state.status;
}

function statusLabel(status: VisualState): string {
  return status[0]!.toUpperCase() + status.slice(1);
}

function backendLabel(backend: Backend | undefined): string {
  return backend === 'webgpu' ? 'WebGPU' : backend === 'wasm' ? 'CPU / WASM' : 'Not loaded';
}

/** One metric tile. The value is only ever a measured number, or an em dash. */
function metric(label: string): [HTMLElement, HTMLElement] {
  const value = el('strong', { class: 'technical-panel__metric-value' }, ['—']);
  return [
    el('div', { class: 'technical-panel__metric' }, [
      el('span', { class: 'technical-panel__metric-label' }, [label]),
      value,
    ]),
    value,
  ];
}

/**
 * A permanent, compact runtime readout: always visible in the sidebar, never a
 * dropdown, never its own scroller. It states only what the runtime actually
 * reported — no invented performance, memory or GPU figures.
 */
export function createTechnicalPanel(): TechnicalPanelView {
  const status = el('div', { class: 'technical-panel__status' });
  const modelName = el('strong', { class: 'technical-panel__model-name' });
  const backend = el('span', { class: 'technical-panel__model-backend' });
  const phase = el('p', { class: 'technical-panel__phase' });
  const meterFill = el('span', { class: 'technical-panel__meter-fill' });
  const meter = el('div', { class: 'technical-panel__meter' }, [meterFill]);
  const [tokensTile, tokensValue] = metric('Tokens');
  const [elapsedTile, elapsedValue] = metric('Elapsed');
  const [rateTile, rateValue] = metric('Tok/s');
  const error = el('p', { class: 'technical-panel__error', role: 'alert' });

  const element = el('section', { class: 'technical-panel', 'aria-label': 'Runtime status' }, [
    el('h2', { class: 'technical-panel__title' }, ['Runtime']),
    status,
    el('div', { class: 'technical-panel__model' }, [modelName, backend]),
    phase,
    meter,
    el('div', { class: 'technical-panel__metrics' }, [tokensTile, elapsedTile, rateTile]),
    error,
  ]);

  let lastState: TechnicalState | undefined;
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;

  /** While generating, elapsed time moves without new tokens arriving. */
  function updateSampling(): void {
    const active = lastState?.generation.generating ?? false;
    if (active && timer === undefined) {
      timer = globalThis.setInterval(() => {
        if (lastState) render(lastState);
      }, 500);
    }
    if (!active && timer !== undefined) {
      globalThis.clearInterval(timer);
      timer = undefined;
    }
  }

  function render(state: TechnicalState): void {
    lastState = state;
    const runtimeStatus = visualStatus(state);
    const resolve = (id: ModelId): ModelConfig =>
      state.models.find((model) => model.id === id) ?? getDefaultModel();
    const selected = resolve(state.selectedId);
    const loaded = state.loadedId ? resolve(state.loadedId) : undefined;

    status.replaceChildren(
      el('span', { class: 'technical-panel__status-dot', 'aria-hidden': 'true' }),
      el('span', { class: 'technical-panel__status-label' }, [statusLabel(runtimeStatus)]),
    );
    status.dataset.state = runtimeStatus;
    status.setAttribute('aria-label', `Runtime status: ${statusLabel(runtimeStatus)}`);

    modelName.textContent = (loaded ?? selected).name;
    backend.textContent = backendLabel(state.backend);

    const loading = state.status === 'loading';
    phase.textContent = loading ? `Phase: ${state.phase ?? 'checking'}` : '';
    phase.hidden = !loading;
    const percent = loading && state.progress !== undefined ? Math.max(0, Math.min(100, state.progress)) : undefined;
    if (percent === undefined) {
      meter.hidden = true;
      meter.removeAttribute('role');
    } else {
      meter.hidden = false;
      meterFill.setAttribute('style', `width:${percent}%`);
      meter.setAttribute('role', 'progressbar');
      meter.setAttribute('aria-label', 'Model download progress');
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      meter.setAttribute('aria-valuenow', String(Math.round(percent)));
      phase.textContent = `Phase: ${state.phase ?? 'downloading'} · ${Math.round(percent)}%`;
    }

    const counted = state.generation.tokenCount > 0;
    tokensValue.textContent = counted ? String(state.generation.tokenCount) : '—';
    elapsedValue.textContent = counted ? formatDuration(state.generation.elapsedMs) : '—';
    const rate = state.generation.tokensPerSecond;
    rateValue.textContent = rate === undefined ? '—' : rate.toFixed(1);

    error.textContent = state.error ?? '';
    error.hidden = !state.error;
    updateSampling();
  }

  return {
    element,
    render,
    destroy(): void {
      if (timer !== undefined) globalThis.clearInterval(timer);
      timer = undefined;
    },
  };
}
