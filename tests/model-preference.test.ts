import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '../src/config/model';
import { createModelPreference, MODEL_PREFERENCE_KEY } from '../src/storage/model-preference';

/** A stand-in for `localStorage`, including the modes that break in private mode. */
function fakeStorage(mode: 'ok' | 'throws-on-write' | 'throws-on-read' = 'ok'): Storage {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      if (mode === 'throws-on-read') throw new Error('storage blocked');
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (mode === 'throws-on-write') throw new Error('storage blocked');
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  } as unknown as Storage;
}

describe('model preference', () => {
  it('starts on the default model when nothing is stored', () => {
    expect(createModelPreference(fakeStorage()).get()).toBe(DEFAULT_MODEL_ID);
  });

  it('remembers a chosen model across sessions', () => {
    const storage = fakeStorage();
    createModelPreference(storage).set('qwen3-0.6b');
    expect(storage.getItem(MODEL_PREFERENCE_KEY)).toBe('qwen3-0.6b');
    expect(createModelPreference(storage).get()).toBe('qwen3-0.6b');
  });

  it('ignores a stored id that is no longer in the catalog', () => {
    const storage = fakeStorage();
    storage.setItem(MODEL_PREFERENCE_KEY, 'retired-model');
    expect(createModelPreference(storage).get()).toBe(DEFAULT_MODEL_ID);
  });

  it('keeps working in memory when writing is blocked', () => {
    const preference = createModelPreference(fakeStorage('throws-on-write'));
    preference.set('granite-4.0-350m');
    expect(preference.get()).toBe('granite-4.0-350m');
  });

  it('keeps working in memory when reading is blocked', () => {
    const preference = createModelPreference(fakeStorage('throws-on-read'));
    expect(preference.get()).toBe(DEFAULT_MODEL_ID);
    preference.set('qwen3-0.6b');
    expect(preference.get()).toBe('qwen3-0.6b');
  });

  it('tolerates having no storage at all', () => {
    const preference = createModelPreference(undefined);
    expect(preference.get()).toBe(DEFAULT_MODEL_ID);
    preference.set('qwen3-0.6b');
    expect(preference.get()).toBe('qwen3-0.6b');
  });
});

describe('model preference with a custom registry', () => {
  it('remembers a custom model id the built-in catalog does not know', () => {
    const storage = fakeStorage();
    storage.setItem(MODEL_PREFERENCE_KEY, 'custom:owner/name');
    const isKnown = (id: string) => id === 'custom:owner/name';
    expect(createModelPreference(storage, isKnown).get()).toBe('custom:owner/name');
    // Without the registry the same stored id is discarded as unknown.
    expect(createModelPreference(storage).get()).toBe(DEFAULT_MODEL_ID);
  });

  it('discards a custom model the user has since removed', () => {
    const storage = fakeStorage();
    storage.setItem(MODEL_PREFERENCE_KEY, 'custom:gone/away');
    expect(createModelPreference(storage, () => false).get()).toBe(DEFAULT_MODEL_ID);
  });
});
