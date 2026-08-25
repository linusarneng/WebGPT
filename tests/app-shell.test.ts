import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppShell, type AppShellView } from '../src/ui/app-shell';
import { el } from '../src/ui/dom';

/** Minimal stand-ins: the shell only needs an `element` from each part. */
function stubParts() {
  const composerInput = el('textarea', { 'aria-label': 'Message WebGPT' }) as HTMLTextAreaElement;
  const parts = {
    sidebar: { element: el('nav', {}, [el('button', { type: 'button' }, ['New chat'])]) },
    chatView: { element: el('div', { class: 'conversation' }) },
    composer: { element: el('div', { class: 'composer' }, [composerInput]) },
    status: { element: el('div', { class: 'status' }) },
  };
  return { parts, composerInput };
}

let shell: AppShellView;
let composerInput: HTMLTextAreaElement;
let menu: HTMLButtonElement;
let scrim: HTMLElement;

beforeEach(() => {
  const stub = stubParts();
  composerInput = stub.composerInput;
  shell = createAppShell(stub.parts as never);
  document.body.append(shell.element);
  menu = shell.element.querySelector('.btn--menu') as HTMLButtonElement;
  scrim = shell.element.querySelector('.scrim') as HTMLElement;
});

afterEach(() => {
  shell.element.remove();
});

describe('app shell drawer', () => {
  it('opens the drawer from the menu button', () => {
    menu.click();
    expect(shell.element.dataset.drawer).toBe('open');
    expect(menu.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on scrim click and returns focus to the menu button', () => {
    menu.click();
    scrim.click();
    expect(shell.element.dataset.drawer).toBe('closed');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
  });

  it('closes on Escape and returns focus to the menu button', () => {
    menu.click();
    shell.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shell.element.dataset.drawer).toBe('closed');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
  });

  it('closes the drawer when focus moves into the main chat flow', () => {
    menu.click();
    composerInput.focus();
    expect(shell.element.dataset.drawer).toBe('closed');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves focus in the main chat flow instead of yanking it back to the menu', () => {
    menu.click();
    composerInput.focus();
    expect(document.activeElement).toBe(composerInput);
  });

  it('keeps the drawer open while focus stays inside the sidebar', () => {
    menu.click();
    (shell.element.querySelector('nav button') as HTMLButtonElement).focus();
    expect(shell.element.dataset.drawer).toBe('open');
    expect(menu.getAttribute('aria-expanded')).toBe('true');
  });
});
