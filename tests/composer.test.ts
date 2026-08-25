import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComposer, type ComposerView } from '../src/ui/composer';

const callbacks = { onSend: vi.fn(), onStop: vi.fn() };
let composer: ComposerView;
const input = (): HTMLTextAreaElement => composer.element.querySelector('.composer__input')!;
const action = (): HTMLButtonElement => composer.element.querySelector('.composer__send')!;

beforeEach(() => {
  vi.clearAllMocks();
  composer = createComposer(callbacks);
  // jsdom only performs implicit form submission for a connected form.
  document.body.append(composer.element);
});

afterEach(() => {
  composer.element.remove();
});

describe('composer readiness', () => {
  it('reads as locked before the model is ready', () => {
    composer.render({ generating: false, disabled: true, placeholder: 'Load the model to start' });
    expect(composer.element.dataset.state).toBe('locked');
    expect(input().disabled).toBe(true);
    expect(action().disabled).toBe(true);
  });

  it('reads as ready once the model is loaded', () => {
    composer.render({ generating: false, disabled: false, placeholder: 'Message WebGPT…' });
    expect(composer.element.dataset.state).toBe('ready');
    expect(input().disabled).toBe(false);
  });

  it('reads as generating and offers Stop while streaming', () => {
    composer.render({ generating: true, disabled: false, placeholder: '' });
    expect(composer.element.dataset.state).toBe('generating');
    expect(action().getAttribute('aria-label')).toBe('Stop generating the response');
    action().click();
    expect(callbacks.onStop).toHaveBeenCalledOnce();
  });

  it('keeps the send control labelled for screen readers when idle', () => {
    composer.render({ generating: false, disabled: false, placeholder: '' });
    expect(action().getAttribute('aria-label')).toBe('Send message');
  });
});
