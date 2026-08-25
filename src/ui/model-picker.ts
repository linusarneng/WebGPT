import { MODEL_CATALOG, type ModelId } from '../config/model';
import { el } from './dom';

export interface ModelPickerCallbacks {
  onSelect(id: ModelId): void;
}

export interface ModelPickerState {
  /** The model the next load will use. */
  selectedId: ModelId;
  /** The model currently resident in the worker, if any. */
  loadedId?: ModelId;
  /** True while switching is not allowed, e.g. mid-generation. */
  locked: boolean;
  /** Shown to the user when locked. */
  lockReason?: string;
}

export interface ModelPickerView {
  readonly element: HTMLElement;
  render(state: ModelPickerState): void;
}

let sequence = 0;

/**
 * The model rack: one radio row per curated model, each stating its trade-off
 * and its first-download size. Selection is separate from loading — choosing a
 * row never starts a download, it only decides what the next load will fetch.
 */
export function createModelPicker(
  callbacks: ModelPickerCallbacks,
  options: { name?: string } = {},
): ModelPickerView {
  const group = options.name ?? `model-choice-${++sequence}`;

  const rows = MODEL_CATALOG.map((model) => {
    const input = el('input', {
      class: 'model-option__input',
      type: 'radio',
      name: group,
      value: model.id,
    }) as HTMLInputElement;

    const badge = el('span', { class: 'model-option__state' });

    const row = el('label', { class: 'model-option' }, [
      input,
      el('span', { class: 'model-option__body' }, [
        el('span', { class: 'model-option__head' }, [
          el('span', { class: 'model-option__name' }, [model.name]),
          badge,
        ]),
        el('span', { class: 'model-option__meta' }, [
          model.tradeoff,
          ' · ',
          `~${model.approximateDownloadMb} MB first download`,
        ]),
        el('span', { class: 'model-option__summary' }, [model.summary]),
      ]),
    ]);

    input.addEventListener('change', () => {
      if (input.disabled) return;
      callbacks.onSelect(model.id);
    });

    return { model, input, row, badge };
  });

  const note = el('p', { class: 'picker__note' }, [
    'Weights download from Hugging Face once and stay cached in this browser. ' +
      'Each model caches separately. Prompts and replies never leave this device.',
  ]);

  const lock = el('p', { class: 'picker__lock', role: 'status' });

  const element = el(
    'div',
    { class: 'picker', role: 'radiogroup', 'aria-label': 'Choose a model' },
    [el('div', { class: 'picker__options' }, rows.map((row) => row.row)), note],
  );

  return {
    element,
    render(state) {
      element.dataset.locked = String(state.locked);
      for (const { model, input, row, badge } of rows) {
        input.checked = model.id === state.selectedId;
        input.disabled = state.locked;
        row.dataset.selected = String(input.checked);
        const isLoaded = model.id === state.loadedId;
        row.dataset.loaded = String(isLoaded);
        badge.textContent = isLoaded ? 'Loaded' : '';
      }

      if (state.locked && state.lockReason) {
        lock.textContent = state.lockReason;
        if (lock.parentNode !== element) element.append(lock);
      } else {
        lock.remove();
      }
    },
  };
}
