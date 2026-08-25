import type { ModelConfig } from '../config/model';
import type { Backend, LoadPhase, RuntimeStatus } from '../inference/protocol';
import { el } from './dom';

export interface ModelStatusView {
  readonly element: HTMLElement;
  render(state: ModelStatusState): void;
}

export interface ModelStatusState {
  /** The model this status is about: the loaded one, or the pending choice. */
  model: ModelConfig;
  status: RuntimeStatus;
  backend?: Backend;
  detail?: string;
  error?: string;
  /** Named stage of the load, when the worker reports one. */
  phase?: LoadPhase;
  /** 0–100, only present while files are downloading. */
  percent?: number;
}

const BACKEND_LABEL: Record<Backend, string> = {
  webgpu: 'WebGPU',
  wasm: 'CPU / WASM',
};

/** The four load stages, in the order the runtime moves through them. */
export const LOAD_PHASES: readonly { id: LoadPhase; label: string }[] = [
  { id: 'checking', label: 'Checking device' },
  { id: 'downloading', label: 'Downloading model' },
  { id: 'preparing', label: 'Preparing model' },
  { id: 'ready', label: 'Ready' },
];

/**
 * Older workers only send a `detail` string. Bytes on the wire are the one
 * unambiguous signal that the download has actually started, so fall back to it
 * rather than guessing a later stage the runtime may not have reached.
 */
export function phaseOf(state: ModelStatusState): LoadPhase | 'idle' | 'error' {
  if (state.status === 'ready') return 'ready';
  if (state.status === 'idle') return 'idle';
  if (state.status === 'error') return 'error';
  return state.phase ?? (state.percent !== undefined ? 'downloading' : 'checking');
}

export function statusLabel(state: ModelStatusState): string {
  const phase = phaseOf(state);
  switch (phase) {
    case 'idle':
      return `${state.model.name} · not loaded`;
    case 'error':
      return 'Model unavailable';
    case 'ready':
      return `${state.model.name} · ${BACKEND_LABEL[state.backend ?? 'wasm']}`;
    case 'downloading':
      return state.percent !== undefined
        ? `Downloading model · ${Math.round(state.percent)}%`
        : 'Downloading model';
    default:
      return LOAD_PHASES.find((entry) => entry.id === phase)!.label;
  }
}

export function statusTitle(state: ModelStatusState): string {
  return state.status === 'error'
    ? (state.error ?? 'The local model could not be loaded.')
    : `${state.model.modelId} runs entirely in this browser tab.`;
}

/**
 * The compact runtime chip. `host` lets the top bar pass its own disclosure
 * button in as the chip, so the live region wraps the control people click.
 */
export function createModelStatus(host?: HTMLElement): ModelStatusView {
  const dot = el('span', { class: 'status__dot', 'aria-hidden': 'true' });
  const text = el('span', { class: 'status__label' });
  const chip = host ?? el('span', { class: 'status__chip' });
  chip.append(dot, text);
  const progressFill = el('span', { class: 'status__fill', style: 'width:0%' });
  const progress = el(
    'span',
    { class: 'status__bar', role: 'progressbar', 'aria-label': 'Model download progress' },
    [progressFill],
  );
  const element = el('div', { class: 'status', 'aria-live': 'polite' }, [chip]);

  return {
    element,
    render(state) {
      const phase = phaseOf(state);
      element.dataset.state = state.status;
      element.dataset.phase = phase;
      text.textContent = statusLabel(state);
      chip.title = statusTitle(state);

      // A bar only appears where real byte counts back it: never during the
      // device check or model preparation, which have no measurable progress.
      if (phase === 'downloading' && state.percent !== undefined) {
        const percent = Math.max(0, Math.min(100, state.percent));
        progressFill.style.width = `${percent}%`;
        progress.setAttribute('aria-valuenow', String(Math.round(percent)));
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', '100');
        if (progress.parentNode !== element) element.append(progress);
      } else if (progress.parentNode === element) {
        progress.remove();
      }
    },
  };
}
