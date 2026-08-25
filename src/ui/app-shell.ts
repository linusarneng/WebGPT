import { el } from './dom';
import { icon } from './icons';
import type { ChatViewView } from './chat-view';
import type { ComposerView } from './composer';
import type { SidebarView } from './sidebar';

export interface AppShellParts {
  sidebar: SidebarView;
  chatView: ChatViewView;
  composer: ComposerView;
  status: { readonly element: HTMLElement };
}

export interface AppShellView {
  readonly element: HTMLElement;
  setTitle(title: string): void;
  closeDrawer(): void;
}

/** Page frame: sidebar/drawer, top bar, conversation region and composer. */
export function createAppShell({ sidebar, chatView, composer, status }: AppShellParts): AppShellView {
  const title = el('h1', { class: 'topbar__title' }, ['New chat']);

  const menuButton = el(
    'button',
    {
      class: 'btn--menu',
      type: 'button',
      'aria-label': 'Open conversation history',
      'aria-expanded': 'false',
      'aria-controls': 'sidebar',
    },
    [icon('menu', 'M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z')],
  );

  const scrim = el('button', { class: 'scrim', type: 'button', tabindex: '-1', 'aria-hidden': 'true' });

  const composerRegion = el('div', { class: 'composer-region' }, [composer.element]);

  const element = el('div', { class: 'app', 'data-drawer': 'closed' }, [
    sidebar.element,
    scrim,
    el('main', { class: 'main' }, [
      el('header', { class: 'topbar' }, [menuButton, title, status.element]),
      chatView.element,
      composerRegion,
    ]),
  ]);

  sidebar.element.id = 'sidebar';

  function setDrawer(open: boolean, restoreFocus = true): void {
    element.dataset.drawer = open ? 'open' : 'closed';
    menuButton.setAttribute('aria-expanded', String(open));
    if (!open && restoreFocus) menuButton.focus();
  }

  menuButton.addEventListener('click', () => setDrawer(element.dataset.drawer !== 'open'));
  scrim.addEventListener('click', () => setDrawer(false));
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && element.dataset.drawer === 'open') setDrawer(false);
  });

  // Moving into the conversation or composer means the user has left the drawer
  // behind; keep their focus where they put it instead of pulling it back.
  const leaveDrawer = (): void => {
    if (element.dataset.drawer === 'open') setDrawer(false, false);
  };
  chatView.element.addEventListener('focusin', leaveDrawer);
  composerRegion.addEventListener('focusin', leaveDrawer);

  return {
    element,
    setTitle(next) {
      title.textContent = next;
    },
    closeDrawer() {
      if (element.dataset.drawer === 'open') setDrawer(false, false);
    },
  };
}
