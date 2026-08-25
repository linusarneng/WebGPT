import { getModel, type ModelId } from '../config/model';
import { el } from './dom';
import { createModelPicker } from './model-picker';
import { createModelStatus, type ModelStatusState } from './model-status';

export interface ModelMenuCallbacks {
  onSelect(id: ModelId): void;
  /** The explicit, deliberate act of fetching and loading the selection. */
  onLoad(): void;
}

export interface ModelMenuState extends ModelStatusState {
  selectedId: ModelId;
  loadedId?: ModelId;
  locked: boolean;
  lockReason?: string;
}

export interface ModelMenuView {
  readonly element: HTMLElement;
  render(state: ModelMenuState): void;
  close(): void;
}

let sequence = 0;

/**
 * The runtime chip in the top bar, doubling as the way back to the model
 * choice once a model is running. It is a disclosure, not a settings screen:
 * the same three rows as the first-run card, plus one explicit load action.
 */
export function createModelMenu(callbacks: ModelMenuCallbacks): ModelMenuView {
  const panelId = `model-menu-panel-${++sequence}`;

  const toggle = el('button', {
    class: 'status__chip model-menu__toggle',
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': panelId,
  }) as HTMLButtonElement;

  const status = createModelStatus(toggle);

  const picker = createModelPicker(
    { onSelect: (id) => callbacks.onSelect(id) },
    { name: 'model-menu-choice' },
  );

  const action = el('button', { class: 'model-menu__action', type: 'button' }) as HTMLButtonElement;
  action.addEventListener('click', () => {
    callbacks.onLoad();
    setOpen(false);
  });

  const resident = el('p', { class: 'model-menu__resident' });
  const foot = el('div', { class: 'model-menu__foot' });

  const panel = el('div', { class: 'model-menu__panel', id: panelId, hidden: '' }, [
    el('p', { class: 'model-menu__eyebrow' }, ['Model']),
    picker.element,
    foot,
  ]);
  panel.hidden = true;

  const element = el('div', { class: 'model-menu' }, [status.element, panel]);

  function setOpen(open: boolean, restoreFocus = true): void {
    panel.hidden = !open;
    element.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    if (!open && restoreFocus) toggle.focus();
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  element.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape' && !panel.hidden) {
      setOpen(false);
    }
  });
  // A click anywhere else is a dismissal, the same as pressing Escape.
  document.addEventListener('pointerdown', (event) => {
    if (panel.hidden) return;
    if (!element.contains(event.target as Node)) setOpen(false, false);
  });

  return {
    element,
    render(state) {
      status.render(state);
      picker.render({
        selectedId: state.selectedId,
        loadedId: state.loadedId,
        locked: state.locked,
        lockReason: state.lockReason,
      });

      const selected = getModel(state.selectedId);
      const isResident = state.selectedId === state.loadedId && state.status === 'ready';

      if (isResident) {
        resident.textContent = `${selected.name} is running in this browser tab.`;
        foot.replaceChildren(resident);
      } else {
        action.textContent =
          state.status === 'loading' ? `Loading ${selected.name}…` : `Load ${selected.name}`;
        action.disabled = state.locked || state.status === 'loading';
        foot.replaceChildren(action);
      }
    },
    close: () => setOpen(false, false),
  };
}
