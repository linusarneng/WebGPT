import { beforeEach, describe, expect, it } from 'vitest';
import { createModelStatus, type ModelStatusView } from '../src/ui/model-status';

let status: ModelStatusView;
const label = (): string => status.element.querySelector('.status__label')!.textContent ?? '';

beforeEach(() => {
  status = createModelStatus();
});

describe('model status', () => {
  it('names the model and its runtime once ready', () => {
    status.render({ status: 'ready', backend: 'webgpu' });
    expect(status.element.dataset.state).toBe('ready');
    expect(status.element.dataset.phase).toBe('ready');
    expect(label()).toContain('Qwen2.5-0.5B-Instruct');
    expect(label()).toContain('WebGPU');
  });

  it('names the CPU runtime on the fallback path', () => {
    status.render({ status: 'ready', backend: 'wasm' });
    expect(label()).toContain('CPU / WASM');
  });

  it('reports the device check phase before any bytes are downloaded', () => {
    status.render({ status: 'loading', phase: 'checking' });
    expect(status.element.dataset.phase).toBe('checking');
    expect(label()).toBe('Checking device');
  });

  it('shows a real percentage only while files are downloading', () => {
    status.render({ status: 'loading', phase: 'downloading', percent: 42.4 });
    expect(status.element.dataset.phase).toBe('downloading');
    expect(label()).toContain('42%');
    expect(status.element.querySelector('.status__bar')).not.toBeNull();
  });

  it('drops the progress bar when preparing the model, rather than faking progress', () => {
    status.render({ status: 'loading', phase: 'downloading', percent: 80 });
    status.render({ status: 'loading', phase: 'preparing' });
    expect(label()).toBe('Preparing model');
    expect(status.element.querySelector('.status__bar')).toBeNull();
  });

  it('infers a phase when the worker does not send one', () => {
    status.render({ status: 'loading' });
    expect(status.element.dataset.phase).toBe('checking');
    status.render({ status: 'loading', percent: 10 });
    expect(status.element.dataset.phase).toBe('downloading');
  });

  it('stays quiet and honest when the model is not loaded', () => {
    status.render({ status: 'idle' });
    expect(status.element.dataset.phase).toBe('idle');
    expect(label()).toBe('Model not loaded');
  });

  it('marks an unavailable model without shouting the raw error', () => {
    status.render({ status: 'error', error: 'network gone' });
    expect(status.element.dataset.phase).toBe('error');
    expect(label()).toBe('Model unavailable');
  });
});
