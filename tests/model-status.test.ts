import { beforeEach, describe, expect, it } from 'vitest';
import { getModel } from '../src/config/model';
import { createModelStatus, type ModelStatusView } from '../src/ui/model-status';

let status: ModelStatusView;
const label = (): string => status.element.querySelector('.status__label')!.textContent ?? '';

beforeEach(() => {
  status = createModelStatus();
});

describe('model status', () => {
  it('names the model and its runtime once ready', () => {
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'ready', backend: 'webgpu' });
    expect(status.element.dataset.state).toBe('ready');
    expect(status.element.dataset.phase).toBe('ready');
    expect(label()).toContain('Qwen2.5 0.5B Instruct');
    expect(label()).toContain('WebGPU');
  });

  it('names the CPU runtime on the fallback path', () => {
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'ready', backend: 'wasm' });
    expect(label()).toContain('CPU / WASM');
  });

  it('reports the device check phase before any bytes are downloaded', () => {
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'loading', phase: 'checking' });
    expect(status.element.dataset.phase).toBe('checking');
    expect(label()).toBe('Checking device');
  });

  it('shows a real percentage only while files are downloading', () => {
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'loading', phase: 'downloading', percent: 42.4 });
    expect(status.element.dataset.phase).toBe('downloading');
    expect(label()).toContain('42%');
    expect(status.element.querySelector('.status__bar')).not.toBeNull();
  });

  it('drops the progress bar when preparing the model, rather than faking progress', () => {
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'loading', phase: 'downloading', percent: 80 });
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'loading', phase: 'preparing' });
    expect(label()).toBe('Preparing model');
    expect(status.element.querySelector('.status__bar')).toBeNull();
  });

  it('infers a phase when the worker does not send one', () => {
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'loading' });
    expect(status.element.dataset.phase).toBe('checking');
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'loading', percent: 10 });
    expect(status.element.dataset.phase).toBe('downloading');
  });

  it('stays quiet and honest when the model is not loaded', () => {
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'idle' });
    expect(status.element.dataset.phase).toBe('idle');
    expect(label()).toContain('not loaded');
  });

  it('marks an unavailable model without shouting the raw error', () => {
    status.render({ model: getModel('qwen2.5-0.5b-instruct'), status: 'error', error: 'network gone' });
    expect(status.element.dataset.phase).toBe('error');
    expect(label()).toBe('Model unavailable');
  });
});

describe('model status names the selected model', () => {
  it('shows whichever model is loaded, not a hard-coded one', () => {
    const view = createModelStatus();
    view.render({ model: getModel('qwen3-0.6b'), status: 'ready', backend: 'webgpu' });
    const text = view.element.querySelector('.status__label')!.textContent ?? '';
    expect(text).toContain('Qwen3 0.6B');
    expect(text).not.toContain('Qwen2.5');
  });

  it('names the model in the idle state so the choice is visible before loading', () => {
    const view = createModelStatus();
    view.render({ model: getModel('granite-4.0-350m'), status: 'idle' });
    expect(view.element.querySelector('.status__label')!.textContent).toContain('Granite 4.0 350M');
  });
});
