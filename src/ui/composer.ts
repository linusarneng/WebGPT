import { el } from './dom';
import { icon } from './icons';

const sendIcon = (): SVGElement => icon('send', 'M12 3.8 19.2 11l-1.4 1.4L13 7.6V20h-2V7.6l-4.8 4.8L4.8 11z');
const stopIcon = (): SVGElement => icon('stop', 'M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z');

export interface ComposerCallbacks {
  onSend(text: string): void;
  onStop(): void;
}

export interface ComposerState {
  /** Generation in progress: the send button becomes Stop. */
  generating: boolean;
  /** The runtime cannot accept prompts yet. */
  disabled: boolean;
  placeholder: string;
}

export interface ComposerView {
  readonly element: HTMLElement;
  render(state: ComposerState): void;
  focus(): void;
  setValue(text: string): void;
}

const MAX_HEIGHT = 200;

export function createComposer(callbacks: ComposerCallbacks): ComposerView {
  let state: ComposerState = { generating: false, disabled: true, placeholder: '' };

  const input = el('textarea', {
    class: 'composer__input',
    id: 'composer-input',
    rows: '1',
    'aria-label': 'Message WebGPT',
  }) as HTMLTextAreaElement;

  const action = el('button', { class: 'composer__send', type: 'submit' }, [sendIcon(), stopIcon()]);
  const hintRight = el('span', { class: 'composer__keys' }, [
    el('kbd', {}, ['Enter']),
    ' to send · ',
    el('kbd', {}, ['Shift']),
    ' + ',
    el('kbd', {}, ['Enter']),
    ' for a new line',
  ]);

  const form = el('form', { class: 'composer', 'data-state': 'locked' }, [
    el('div', { class: 'composer__field' }, [input, action]),
    el('div', { class: 'composer__hint' }, [
      el('span', { class: 'composer__status' }, []),
      hintRight,
    ]),
  ]);

  function autosize(): void {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT)}px`;
  }

  function submit(): void {
    if (state.generating) {
      callbacks.onStop();
      return;
    }
    const text = input.value.trim();
    if (!text || state.disabled) return;
    input.value = '';
    autosize();
    callbacks.onSend(text);
    input.focus();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (event) => {
    // Enter sends; Shift+Enter (and IME composition) insert a newline.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });

  const statusSlot = form.querySelector('.composer__status') as HTMLElement;

  return {
    element: form,
    render(next) {
      state = next;
      input.disabled = next.disabled && !next.generating;
      input.placeholder = next.placeholder;
      form.dataset.state = next.generating ? 'generating' : next.disabled ? 'locked' : 'ready';
      action.setAttribute(
        'aria-label',
        next.generating ? 'Stop generating the response' : 'Send message',
      );
      action.disabled = !next.generating && next.disabled;
      input.setAttribute('aria-disabled', String(input.disabled));
      statusSlot.textContent = next.generating ? 'Generating on this device…' : '';
    },
    focus() {
      if (!input.disabled) input.focus();
    },
    setValue(text) {
      input.value = text;
      autosize();
    },
  };
}
