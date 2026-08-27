import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_CATALOG, getModel } from '../src/config/model';
import { createModelMenu, type ModelMenuView } from '../src/ui/model-menu';

const onSelect = vi.fn();
const onLoad = vi.fn();
let menu: ModelMenuView;

const toggle = (): HTMLButtonElement =>
  menu.element.querySelector('.model-menu__toggle') as HTMLButtonElement;
const panel = (): HTMLElement => menu.element.querySelector('.model-menu__panel') as HTMLElement;
const action = (): HTMLButtonElement | null =>
  menu.element.querySelector('.model-menu__action');

function render(overrides: Partial<Parameters<ModelMenuView['render']>[0]> = {}): void {
  menu.render({
    models: MODEL_CATALOG,
    model: getModel('qwen2.5-0.5b-instruct'),
    status: 'ready',
    backend: 'webgpu',
    selectedId: 'qwen2.5-0.5b-instruct',
    loadedId: 'qwen2.5-0.5b-instruct',
    locked: false,
    ...overrides,
  });
}

beforeEach(() => {
  onSelect.mockReset();
  onLoad.mockReset();
  menu = createModelMenu({ onSelect, onLoad });
  document.body.replaceChildren(menu.element);
});

describe('top bar model menu', () => {
  it('is a closed disclosure that announces what it opens', () => {
    render();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe(panel().id);
    expect(panel().hidden).toBe(true);
  });

  it('names the running model on the toggle itself', () => {
    render({ model: getModel('qwen3-0.6b'), selectedId: 'qwen3-0.6b', loadedId: 'qwen3-0.6b' });
    expect(toggle().textContent).toContain('Qwen3 0.6B');
  });

  it('opens and closes on the toggle', () => {
    render();
    toggle().click();
    expect(panel().hidden).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    toggle().click();
    expect(panel().hidden).toBe(true);
  });

  it('closes on Escape and hands focus back to the toggle', () => {
    render();
    toggle().click();
    panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(toggle());
  });

  it('carries the picker so the selection can be changed from the top bar', () => {
    render();
    toggle().click();
    const radio = panel().querySelector<HTMLInputElement>('input[value="qwen3-0.6b"]')!;
    radio.click();
    expect(onSelect).toHaveBeenCalledWith('qwen3-0.6b');
  });

  it('asks for an explicit load when the selection is not the loaded model', () => {
    render({ selectedId: 'qwen3-0.6b' });
    toggle().click();
    expect(action()!.disabled).toBe(false);
    expect(action()!.textContent).toContain('Load Qwen3 0.6B');
    action()!.click();
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('offers no load action while the selected model is already running', () => {
    render();
    toggle().click();
    expect(action()).toBeNull();
    expect(panel().textContent).toMatch(/running in this browser/i);
  });

  it('refuses to switch mid-reply and says so', () => {
    render({ selectedId: 'qwen3-0.6b', locked: true, lockReason: 'Stop the reply first.' });
    toggle().click();
    expect(panel().querySelector<HTMLInputElement>('input[value="qwen3-0.6b"]')!.disabled).toBe(true);
    expect(action()!.disabled).toBe(true);
    expect(panel().textContent).toContain('Stop the reply first.');
  });

  it('stays open across re-renders so a choice can be reviewed', () => {
    render();
    toggle().click();
    render({ selectedId: 'qwen3-0.6b' });
    expect(panel().hidden).toBe(false);
  });
});
