import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '../src/domain/chat';
import { createSidebar, type SidebarView } from '../src/ui/sidebar';

const callbacks = { onNewChat: vi.fn(), onSelect: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() };

let sidebar: SidebarView;
const q = (selector: string): HTMLElement | null => sidebar.element.querySelector(selector);

const chat = (id: string, title: string): Conversation => ({
  id, title, messages: [], createdAt: 0, updatedAt: Date.now(),
});

beforeEach(() => {
  vi.clearAllMocks();
  sidebar = createSidebar(callbacks);
  document.body.replaceChildren(sidebar.element);
});
afterEach(() => sidebar.destroy());

describe('sidebar hierarchy', () => {
  it('leads with brand, New chat and the permanent technical panel', () => {
    sidebar.render([chat('a', 'One')], 'a');
    const order = [...sidebar.element.querySelectorAll('.brand, .new-chat, .technical-panel, .history')].map(
      (node) => node.className.split(' ')[0],
    );
    expect(order).toEqual(['brand', 'new-chat', 'technical-panel', 'history']);
  });

  it('puts conversation history in a collapsed native details disclosure', () => {
    sidebar.render([chat('a', 'One')], 'a');
    const history = q('.history') as HTMLDetailsElement;
    expect(history.tagName).toBe('DETAILS');
    expect(history.open).toBe(false);
    expect(history.querySelector('summary')!.textContent).toContain('History');
    expect(history.querySelector('.chat-list')).not.toBeNull();
  });

  it('keeps New chat immediate and outside the disclosure', () => {
    sidebar.render([], undefined);
    const newChat = q('.new-chat') as HTMLButtonElement;
    expect(newChat.closest('.history')).toBeNull();
    newChat.click();
    expect(callbacks.onNewChat).toHaveBeenCalled();
  });

  it('still selects, renames and deletes chats from inside history', () => {
    sidebar.render([chat('a', 'One'), chat('b', 'Two')], 'a');
    expect(sidebar.element.querySelectorAll('.chat-item')).toHaveLength(2);
    (q('.chat-item__select') as HTMLButtonElement).click();
    expect(callbacks.onSelect).toHaveBeenCalledWith('a');
  });
});
