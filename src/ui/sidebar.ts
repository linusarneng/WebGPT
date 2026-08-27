import type { Conversation } from '../domain/chat';
import { formatRelativeTime } from '../utils/time';
import { clear, el } from './dom';
import { icon } from './icons';
import { createTechnicalPanel, type TechnicalPanelView, type TechnicalState } from './technical-panel';

export interface SidebarCallbacks {
  onNewChat(): void;
  onSelect(id: string): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}

export interface SidebarView {
  readonly element: HTMLElement;
  render(conversations: readonly Conversation[], activeId: string | undefined): void;
  renderTechnical(state: TechnicalState): void;
  destroy(): void;
}

const NEW_ICON = 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z';
const RENAME_ICON = 'M4 16.5 15.1 5.4l3.5 3.5L7.5 20H4zM16.6 3.9l1.5-1.5 3.5 3.5-1.5 1.5z';
const DELETE_ICON = 'M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 12H7z';

/** Compact icon control; the visible label lives in `aria-label` only. */
function iconButton(name: string, path: string, ariaLabel: string): HTMLButtonElement {
  return el('button', { class: 'chat-item__action', type: 'button', 'aria-label': ariaLabel }, [
    icon(name, path),
  ]) as HTMLButtonElement;
}

export function createSidebar(callbacks: SidebarCallbacks): SidebarView {
  // Which conversation is currently showing its inline rename field.
  let renamingId: string | undefined;
  let conversations: readonly Conversation[] = [];
  let activeId: string | undefined;

  const list = el('ul', { class: 'chat-list' });
  const historyCount = el('span', { class: 'history__count' });
  const technical: TechnicalPanelView = createTechnicalPanel();

  const newChatButton = el('button', { class: 'new-chat', type: 'button' }, [
    icon('plus', NEW_ICON),
    el('span', {}, ['New chat']),
  ]);
  newChatButton.addEventListener('click', () => {
    renamingId = undefined;
    callbacks.onNewChat();
  });

  const element = el('nav', { class: 'sidebar', 'aria-label': 'Conversation history' }, [
    el('div', { class: 'sidebar__head' }, [
      el('span', { class: 'brand' }, [
        brandMark(),
        el('span', { class: 'brand__name' }, ['WebGPT']),
      ]),
    ]),
    el('div', { class: 'sidebar__new' }, [newChatButton]),
    el('div', { class: 'sidebar__tech' }, [technical.element]),
    el('div', { class: 'sidebar__body' }, [
      el('details', { class: 'history' }, [
        el('summary', { class: 'history__summary' }, [
          el('span', { class: 'history__label' }, ['History']),
          historyCount,
        ]),
        el('div', { class: 'history__body' }, [list]),
      ]),
    ]),
    el('div', { class: 'sidebar__foot' }, ['Conversations stay in this browser.']),
  ]);

  function renderRenameForm(conversation: Conversation): HTMLElement {
    const input = el('input', {
      class: 'chat-item__rename-input',
      type: 'text',
      value: conversation.title,
      'aria-label': `Rename ${conversation.title}`,
    }) as HTMLInputElement;
    const form = el('form', { class: 'chat-item__rename-form' }, [input]);

    const commit = (): void => {
      const value = input.value;
      renamingId = undefined;
      callbacks.onRename(conversation.id, value);
      render(conversations, activeId);
    };
    const cancel = (): void => {
      renamingId = undefined;
      render(conversations, activeId);
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      commit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener('blur', commit);
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return form;
  }

  function renderItem(conversation: Conversation): HTMLElement {
    const item = el('li', {
      class: 'chat-item',
      'data-chat-id': conversation.id,
      'aria-current': String(conversation.id === activeId),
    });

    if (renamingId === conversation.id) {
      item.append(renderRenameForm(conversation));
      return item;
    }

    const select = el('button', { class: 'chat-item__select', type: 'button' }, [
      el('span', { class: 'chat-item__title' }, [conversation.title]),
      el('span', { class: 'chat-item__meta' }, [
        `${conversation.messages.length} message${conversation.messages.length === 1 ? '' : 's'} · ${formatRelativeTime(conversation.updatedAt)}`,
      ]),
    ]);
    select.addEventListener('click', () => callbacks.onSelect(conversation.id));

    const rename = iconButton('rename', RENAME_ICON, `Rename “${conversation.title}”`);
    rename.addEventListener('click', () => {
      renamingId = conversation.id;
      render(conversations, activeId);
    });

    const remove = iconButton('delete', DELETE_ICON, `Delete “${conversation.title}”`);
    remove.addEventListener('click', () => {
      const confirmed =
        conversation.messages.length === 0 ||
        globalThis.confirm(`Delete “${conversation.title}”? This cannot be undone.`);
      if (confirmed) callbacks.onDelete(conversation.id);
    });

    item.append(select, el('span', { class: 'chat-item__actions' }, [rename, remove]));
    return item;
  }

  function render(next: readonly Conversation[], nextActiveId: string | undefined): void {
    conversations = next;
    activeId = nextActiveId;
    clear(list);
    historyCount.textContent = next.length === 0 ? '' : String(next.length);
    if (next.length === 0) {
      list.append(el('li', { class: 'chat-list__empty' }, ['No conversations yet.']));
      return;
    }
    for (const conversation of next) list.append(renderItem(conversation));
  }

  return {
    element,
    render,
    renderTechnical(state) {
      technical.render(state);
    },
    destroy() {
      technical.destroy();
    },
  };
}

/**
 * The WebGPT mark: a rounded square holding a single chevron-and-bar glyph —
 * a prompt caret, drawn as the model's front door rather than a letterform.
 */
function brandMark(): SVGElement {
  const mark = icon('brand', 'M6.2 7.4 10.6 12l-4.4 4.6 1.5 1.5L13.6 12 7.7 5.9zM13 16.2h5v2h-5z');
  mark.classList.add('brand__mark');
  return mark;
}
