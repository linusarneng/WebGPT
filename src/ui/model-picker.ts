import { formatDownloadSize, type ModelConfig, type ModelId } from '../config/model';
import { clear, el } from './dom';
import { createModelAddForm, type ModelAddState, type ModelAddView } from './model-add';

export interface ModelPickerCallbacks {
  onSelect(id: ModelId): void;
  /** Supplying these turns on the "add a model" form beneath the rack. */
  onCheckModel?(input: string): void;
  onConfirmModel?(): void;
  onDismissModel?(): void;
  onRemoveModel?(id: ModelId): void;
}

export interface ModelPickerState {
  /** Every model this browser can choose from: built-ins, then custom ones. */
  models: readonly ModelConfig[];
  /** The model the next load will use. */
  selectedId: ModelId;
  /** The model currently resident in the worker, if any. */
  loadedId?: ModelId;
  /** True while switching is not allowed, e.g. mid-generation. */
  locked: boolean;
  /** Shown to the user when locked. */
  lockReason?: string;
  /** State of the add-a-model form, when it is enabled. */
  add?: ModelAddState;
}

export interface ModelPickerView {
  readonly element: HTMLElement;
  render(state: ModelPickerState): void;
}

let sequence = 0;

interface Row {
  model: ModelConfig;
  input: HTMLInputElement;
  row: HTMLElement;
  badge: HTMLElement;
}

/**
 * The model rack: one radio row per model, each stating its trade-off and its
 * first-download size. Selection is separate from loading — choosing a row never
 * starts a download, it only decides what the next load will fetch.
 *
 * The rack is rebuilt whenever the set of models changes, because the user can
 * add and remove their own repositories while the app is running.
 */
export function createModelPicker(
  callbacks: ModelPickerCallbacks,
  options: { name?: string } = {},
): ModelPickerView {
  const group = options.name ?? `model-choice-${++sequence}`;
  const optionList = el('div', { class: 'picker__options' });

  const note = el('p', { class: 'picker__note' }, [
    'Weights download from Hugging Face once and stay cached in this browser. ' +
      'Each model caches separately. Prompts and replies never leave this device.',
  ]);

  const lock = el('p', { class: 'picker__lock', role: 'status' });

  const element = el(
    'div',
    { class: 'picker', role: 'radiogroup', 'aria-label': 'Choose a model' },
    [optionList, note],
  );

  const addForm: ModelAddView | undefined = callbacks.onCheckModel
    ? createModelAddForm({
        onCheck: (input) => callbacks.onCheckModel?.(input),
        onConfirm: () => callbacks.onConfirmModel?.(),
        onDismiss: () => callbacks.onDismissModel?.(),
      })
    : undefined;
  if (addForm) element.append(addForm.element);

  let rows: Row[] = [];
  /** The model set the current rack was built from, so rebuilds stay rare. */
  let signature = '';

  function buildRow(model: ModelConfig): Row {
    const input = el('input', {
      class: 'model-option__input',
      type: 'radio',
      name: group,
      value: model.id,
    }) as HTMLInputElement;

    const badge = el('span', { class: 'model-option__state' });

    const row = el('label', { class: 'model-option' }, [
      input,
      el('span', { class: 'model-option__head' }, [
        el('span', { class: 'model-option__name' }, [model.name]),
        badge,
      ]),
      el('span', { class: 'model-option__meta' }, [model.tradeoff]),
      el('span', { class: 'model-option__summary' }, [model.summary]),
      el('span', { class: 'model-option__size' }, [formatDownloadSize(model)]),
    ]);
    if (model.custom) row.dataset.custom = 'true';

    input.addEventListener('change', () => {
      if (input.disabled) return;
      callbacks.onSelect(model.id);
    });

    if (model.custom && callbacks.onRemoveModel) {
      const remove = el(
        'button',
        { class: 'model-option__remove', type: 'button', 'aria-label': `Remove ${model.name}` },
        ['Remove'],
      );
      // The row is a label, so a click inside it would otherwise select the radio.
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        callbacks.onRemoveModel?.(model.id);
      });
      row.append(remove);
    }

    return { model, input, row, badge };
  }

  function rebuild(models: readonly ModelConfig[]): void {
    rows = models.map(buildRow);
    clear(optionList);
    optionList.append(...rows.map((row) => row.row));
  }

  return {
    element,
    render(state) {
      const next = state.models.map((model) => model.id).join('|');
      if (next !== signature) {
        signature = next;
        rebuild(state.models);
      }

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
        if (lock.parentNode !== element) note.after(lock);
      } else {
        lock.remove();
      }

      addForm?.render(state.add ?? { status: 'idle', locked: state.locked });
    },
  };
}
