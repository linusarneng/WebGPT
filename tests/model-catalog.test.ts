import { describe, expect, it } from 'vitest';
import {
  buildPromptMessages,
  DEFAULT_MODEL_ID,
  GENERATION,
  MODEL_CATALOG,
  getModel,
  getDefaultModel,
  isModelId,
} from '../src/config/model';

describe('model catalog', () => {
  it('offers exactly three curated models', () => {
    expect(MODEL_CATALOG).toHaveLength(3);
  });

  it('keeps Qwen2.5-0.5B-Instruct as the recommended default', () => {
    const fallback = getDefaultModel();
    expect(fallback.id).toBe(DEFAULT_MODEL_ID);
    expect(fallback.modelId).toBe('onnx-community/Qwen2.5-0.5B-Instruct');
    expect(fallback.tradeoff).toMatch(/recommended/i);
  });

  it('describes every option with a name, tradeoff, size and dtypes', () => {
    for (const model of MODEL_CATALOG) {
      expect(model.name).not.toBe('');
      expect(model.tradeoff).not.toBe('');
      expect(model.summary).not.toBe('');
      expect(model.modelId).toMatch(/^[\w-]+\/[\w.-]+$/);
      expect(model.approximateDownloadMb).toBeGreaterThan(0);
      expect(model.webgpuDtype).toBeTruthy();
      expect(model.wasmDtype).toBeTruthy();
    }
  });

  it('gives every option a unique id and repo', () => {
    expect(new Set(MODEL_CATALOG.map((m) => m.id)).size).toBe(3);
    expect(new Set(MODEL_CATALOG.map((m) => m.modelId)).size).toBe(3);
  });

  it('looks a model up by id', () => {
    const target = MODEL_CATALOG[1]!;
    expect(getModel(target.id)).toBe(target);
  });

  it('falls back to the default for unknown, missing or malformed ids', () => {
    const fallback = getDefaultModel();
    expect(getModel('nope')).toBe(fallback);
    expect(getModel(undefined)).toBe(fallback);
    expect(getModel(null)).toBe(fallback);
    expect(getModel('')).toBe(fallback);
  });

  it('recognises catalog ids', () => {
    expect(isModelId(DEFAULT_MODEL_ID)).toBe(true);
    expect(isModelId('nope')).toBe(false);
  });

  it('bounds the prompt and always leads with the system message', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`,
    }));
    const prompt = buildPromptMessages(history);
    expect(prompt[0]!.role).toBe('system');
    expect(prompt).toHaveLength(GENERATION.maxHistoryMessages + 1);
    expect(prompt.at(-1)!.content).toBe('m29');
  });
});
