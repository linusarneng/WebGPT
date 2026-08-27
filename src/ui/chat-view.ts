import type { ModelConfig, ModelId } from '../config/model';
import type { Conversation, Message } from '../domain/chat';
import { splitThinking } from '../domain/thinking';
import type { LoadPhase, RuntimeStatus } from '../inference/protocol';
import { clear, el } from './dom';
import { icon } from './icons';
import { renderRichText } from './markdown';
import { createModelPicker, type ModelPickerView } from './model-picker';
import { LOAD_PHASES } from './model-status';

export interface ChatViewCallbacks {
  onLoadModel(): void;
  onSelectModel(id: ModelId): void;
  onRetry(messageId: string): void;
  onCopy(text: string): void;
}

export interface ChatViewState {
  conversation: Conversation | undefined;
  /** The model the card is about: the pending choice, or the running one. */
  model: ModelConfig;
  selectedId: ModelId;
  loadedId?: ModelId;
  /** True while the choice cannot change, e.g. mid-reply. */
  locked: boolean;
  lockReason?: string;
  runtimeStatus: RuntimeStatus;
  runtimeError?: string;
  runtimeWarning?: string;
  storageWarning?: string;
  runtimePhase?: LoadPhase;
  runtimePercent?: number;
}

export interface ChatViewView {
  readonly element: HTMLElement;
  render(state: ChatViewState): void;
}

const COPY_ICON = 'M9 3h9v13h-3v3H6V6h3zm2 2v9h5V5zM8 8v9h5v-1H9V8z';
const RETRY_ICON = 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z';

/** One row of the spec table: a machine fact and its plain-language value. */
function specRow(term: string, value: string): HTMLElement {
  return el('div', { class: 'spec' }, [
    el('span', { class: 'spec__term' }, [term]),
    el('span', { class: 'spec__value' }, [value]),
  ]);
}

export function createChatView(callbacks: ChatViewCallbacks): ChatViewView {
  const picker: ModelPickerView = createModelPicker(
    { onSelect: (id) => callbacks.onSelectModel(id) },
    { name: 'model-card-choice' },
  );
  const list = el('ul', { class: 'message-list' });
  const inner = el('div', { class: 'conversation__inner' }, [list]);
  const element = el('div', { class: 'conversation', tabindex: '0' }, [inner]);
  // Auto-scroll only while the user is already reading the newest output.
  let pinnedToBottom = true;

  element.addEventListener('scroll', () => {
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinnedToBottom = distance < 80;
  });

  /** The phase rail: four named stages, no invented progress between them. */
  function renderPhaseRail(current: LoadPhase): HTMLElement {
    const index = LOAD_PHASES.findIndex((phase) => phase.id === current);
    const rail = el('ol', { class: 'plate__rail' });
    LOAD_PHASES.forEach((phase, position) => {
      rail.append(
        el(
          'li',
          {
            class: 'phase',
            'data-state': position < index ? 'done' : position === index ? 'active' : 'pending',
            ...(position === index ? { 'aria-current': 'step' } : {}),
          },
          [phase.label],
        ),
      );
    });
    return rail;
  }

  function renderMeter(percent: number): HTMLElement {
    const bounded = Math.max(0, Math.min(100, percent));
    const fill = el('span', { class: 'plate__fill', style: `width:${bounded}%` });
    return el(
      'div',
      {
        class: 'plate__meter',
        role: 'progressbar',
        'aria-label': 'Model download progress',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(Math.round(bounded)),
      },
      [fill],
    );
  }

  /**
   * The install plate: the model's identity card before it exists on this device.
   * It carries the same facts the top-bar chip shows once the model is resident.
   */
  function renderPlate(state: ChatViewState): HTMLElement {
    const loading = state.runtimeStatus === 'loading';
    const phase: LoadPhase = state.runtimePhase ?? (state.runtimePercent !== undefined ? 'downloading' : 'checking');
    const model = state.model;

    const plate = el('section', { class: 'plate', 'data-state': loading ? 'loading' : 'idle' }, [
      el('p', { class: 'plate__eyebrow' }, ['WebGPT · local runtime']),
      el('h1', { class: 'plate__title' }, [`Run ${model.name} in this browser.`]),
      el('div', { class: 'plate__specs' }, [
        specRow('Repository', model.modelId),
        specRow('Runs on', 'Your device — WebGPU, or CPU if WebGPU is unavailable'),
        specRow('Needs', 'No account, no API key, no server'),
        specRow('First load', `About ${model.approximateDownloadMb} MB, then cached in this browser`),
      ]),
    ]);

    picker.render({
      selectedId: state.selectedId,
      loadedId: state.loadedId,
      locked: state.locked || loading,
      lockReason: state.lockReason,
    });
    plate.append(picker.element);

    if (loading) {
      plate.append(renderPhaseRail(phase));
      if (phase === 'downloading' && state.runtimePercent !== undefined) {
        plate.append(renderMeter(state.runtimePercent));
      }
    } else {
      const load = el('button', { class: 'plate__cta', type: 'button' }, [
        `Load ${model.name}`,
        el('span', { class: 'plate__cta-size' }, [`~${model.approximateDownloadMb} MB`]),
      ]);
      load.addEventListener('click', callbacks.onLoadModel);
      plate.append(load);
    }

    return plate;
  }

  function renderEmptyState(state: ChatViewState): HTMLElement {
    const empty = el('div', { class: 'empty', 'data-runtime': state.runtimeStatus });

    if (state.runtimeStatus === 'idle' || state.runtimeStatus === 'loading') {
      empty.append(renderPlate(state));
    } else if (state.runtimeStatus === 'ready') {
      empty.append(
        el('h1', { class: 'empty__title' }, ['What would you like to work on?']),
        el('p', { class: 'empty__subtitle' }, [
          `${state.model.name} is loaded and answering on this device. It is a small model — fast and private, and less capable than a large hosted assistant.`,
        ]),
      );
    }

    if (state.runtimeStatus === 'error') {
      empty.append(
        el('h1', { class: 'empty__title' }, ['The model could not be loaded.']),
        renderErrorNotice(state.runtimeError, 'Try loading again'),
      );
    }

    return empty;
  }

  /** Failure stays one plain sentence; the raw cause waits behind a disclosure. */
  function renderErrorNotice(error: string | undefined, actionLabel: string): HTMLElement {
    const notice = el('div', { class: 'notice notice--error', role: 'alert' }, [
      el('p', { class: 'notice__text' }, [
        'The model files could not be fetched. Check your connection and try again — nothing was sent anywhere.',
      ]),
    ]);

    if (error) {
      notice.append(
        el('details', { class: 'notice__details' }, [
          el('summary', {}, ['Technical details']),
          el('p', { class: 'notice__cause' }, [error]),
        ]),
      );
    }

    const retry = el('button', { class: 'notice__action', type: 'button' }, [actionLabel]);
    retry.addEventListener('click', callbacks.onLoadModel);
    notice.append(retry);
    return notice;
  }

  /**
   * Model-emitted reasoning, in its own compact disclosure. Collapsed as soon as
   * a final answer exists; open and explicitly active while only thinking has
   * streamed. Nothing here is inferred — it is the model's own tagged text.
   */
  function renderThinking(text: string, active: boolean): HTMLDetailsElement {
    const details = el(
      'details',
      { class: 'thinking', 'data-state': active ? 'active' : 'done', ...(active ? { open: '' } : {}) },
      [
        el('summary', { class: 'thinking__summary' }, [
          ...(active ? [el('span', { class: 'message__pulse', 'aria-hidden': 'true' })] : []),
          el('span', { class: 'thinking__label' }, [active ? 'Thinking…' : 'Show thinking']),
        ]),
        el('div', { class: 'thinking__body' }, [renderRichText(text)]),
      ],
    ) as HTMLDetailsElement;
    return details;
  }

  function renderActions(answer: string): HTMLElement {
    const copy = el(
      'button',
      { class: 'msg-action', type: 'button', 'aria-label': 'Copy this response' },
      [icon('copy', COPY_ICON), el('span', { class: 'msg-action__label' }, ['Copy'])],
    );
    const copyLabel = copy.querySelector('.msg-action__label') as HTMLElement;
    copy.addEventListener('click', () => {
      callbacks.onCopy(answer);
      copyLabel.textContent = 'Copied';
      copy.dataset.done = 'true';
      setTimeout(() => {
        copyLabel.textContent = 'Copy';
        delete copy.dataset.done;
      }, 1400);
    });
    return el('div', { class: 'message__actions' }, [copy]);
  }

  function renderMessage(message: Message): HTMLElement {
    const item = el('li', {
      class: `message message--${message.role}`,
      'data-message-id': message.id,
      'data-status': message.status,
    });
    item.append(
      el('span', { class: 'message__role' }, [message.role === 'user' ? 'You' : 'WebGPT']),
    );

    const split = message.role === 'assistant'
      ? splitThinking(message.text)
      : { thinking: '', answer: message.text, hasThinking: false, thinkingActive: false };

    const body = el('div', { class: 'message__body' });
    if (message.role === 'assistant' && message.status === 'pending') {
      body.append(
        el('p', { class: 'message__thinking' }, [
          el('span', { class: 'message__pulse', 'aria-hidden': 'true' }),
          'Thinking…',
        ]),
      );
    } else {
      if (split.hasThinking) {
        body.append(renderThinking(split.thinking, split.thinkingActive && message.status === 'streaming'));
      }
      if (split.answer || !split.hasThinking) {
        const answer = el(
          'div',
          { class: message.role === 'assistant' ? 'message__answer' : 'message__text' },
          [renderRichText(split.answer)],
        );
        if (message.status === 'streaming') {
          answer.append(el('span', { class: 'message__cursor', 'aria-hidden': 'true' }));
        }
        body.append(answer);
      }
    }
    item.append(body);

    if (message.role === 'assistant' && message.status === 'stopped') {
      item.append(el('p', { class: 'message__note' }, ['Stopped. The partial reply is kept above.']));
    }

    if (message.role === 'assistant' && message.status === 'failed') {
      const retry = el(
        'button',
        { class: 'msg-action', type: 'button', 'aria-label': 'Retry this response' },
        [icon('retry', RETRY_ICON), el('span', { class: 'msg-action__label' }, ['Retry'])],
      );
      retry.addEventListener('click', () => callbacks.onRetry(message.id));
      item.append(
        el('p', { class: 'message__note message__note--error', role: 'alert' }, [
          message.error ?? 'This response failed.',
          retry,
        ]),
      );
    }

    if (message.role === 'assistant' && (message.status === 'done' || message.status === 'stopped') && split.answer) {
      item.append(renderActions(split.answer));
    }

    return item;
  }

  return {
    element,
    render(state) {
      clear(inner);
      const messages = state.conversation?.messages ?? [];

      if (state.storageWarning) {
        inner.append(
          el('div', { class: 'notice notice--warn', role: 'status' }, [
            el('p', { class: 'notice__text' }, [state.storageWarning]),
          ]),
        );
      }
      if (state.runtimeWarning && state.runtimeStatus === 'ready') {
        inner.append(
          el('div', { class: 'notice notice--warn', role: 'status' }, [
            el('p', { class: 'notice__text' }, [state.runtimeWarning]),
          ]),
        );
      }

      if (messages.length === 0) {
        inner.append(renderEmptyState(state));
        return;
      }

      clear(list);
      for (const message of messages) list.append(renderMessage(message));
      inner.append(list);

      if (state.runtimeStatus === 'error' && state.runtimeError) {
        inner.append(renderErrorNotice(state.runtimeError, 'Reload model'));
      }

      if (pinnedToBottom) {
        // Wait for layout so the scroll target reflects the new content height.
        requestAnimationFrame(() => {
          element.scrollTop = element.scrollHeight;
        });
      }
    },
  };
}
