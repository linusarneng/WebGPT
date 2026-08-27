import { formatDownloadSize, type ModelConfig } from '../config/model';
import { clear, el } from './dom';

export type AddModelStatus = 'idle' | 'checking' | 'found' | 'error';

export interface ModelAddState {
  status: AddModelStatus;
  /** The repo that passed the compatibility check, awaiting confirmation. */
  candidate?: ModelConfig;
  /** Why the last check failed, in the repository's own terms. */
  error?: string;
  /** True while a load is in flight and the catalog must not change. */
  locked: boolean;
}

export interface ModelAddCallbacks {
  onCheck(input: string): void;
  onConfirm(): void;
  onDismiss(): void;
}

export interface ModelAddView {
  readonly element: HTMLElement;
  render(state: ModelAddState): void;
}

/**
 * The form that turns a pasted Hugging Face link into a model card. Checking is
 * deliberately a separate step from adding: the user sees the real download size
 * and the reason the repo is compatible before committing to anything.
 */
export function createModelAddForm(callbacks: ModelAddCallbacks): ModelAddView {
  const input = el('input', {
    class: 'model-add__input',
    type: 'text',
    placeholder: 'owner/name, or a huggingface.co link',
    'aria-label': 'Hugging Face repository',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;

  const submit = el('button', { class: 'model-add__submit', type: 'submit' }, ['Check']) as HTMLButtonElement;
  const result = el('div', { class: 'model-add__result' });

  const form = el('form', { class: 'model-add' }, [
    el('p', { class: 'model-add__title' }, ['Add a model from Hugging Face']),
    el('div', { class: 'model-add__row' }, [input, submit]),
    el('p', { class: 'model-add__hint' }, [
      'The repository must publish ONNX weights and a chat template. WebGPT checks before downloading anything.',
    ]),
    result,
  ]) as HTMLFormElement;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value) callbacks.onCheck(value);
  });

  /** The compatible repo, stated as the facts that decided it. */
  function renderCandidate(model: ModelConfig): void {
    const confirm = el('button', { class: 'model-add__confirm', type: 'button' }, [`Add ${model.name}`]);
    confirm.addEventListener('click', () => callbacks.onConfirm());
    const dismiss = el('button', { class: 'model-add__dismiss', type: 'button' }, ['Cancel']);
    dismiss.addEventListener('click', () => callbacks.onDismiss());

    result.append(
      el('div', { class: 'model-add__found', role: 'status' }, [
        el('p', { class: 'model-add__found-name' }, [model.modelId]),
        el('p', { class: 'model-add__found-facts' }, [
          `${formatDownloadSize(model)} · ${model.webgpuDtype} on WebGPU · ${model.wasmDtype} on CPU`,
        ]),
        el('div', { class: 'model-add__actions' }, [confirm, dismiss]),
      ]),
    );
  }

  return {
    element: form,
    render(state) {
      clear(result);
      form.dataset.status = state.status;
      input.disabled = state.locked || state.status === 'checking';
      submit.disabled = input.disabled;
      submit.textContent = state.status === 'checking' ? 'Checking…' : 'Check';

      if (state.status === 'found' && state.candidate) {
        renderCandidate(state.candidate);
      } else if (state.status === 'error' && state.error) {
        result.append(el('p', { class: 'model-add__error', role: 'alert' }, [state.error]));
      }
    },
  };
}
