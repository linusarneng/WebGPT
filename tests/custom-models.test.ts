import { beforeEach, describe, expect, it } from 'vitest';
import { CUSTOM_MODELS_KEY, createCustomModelStore } from '../src/storage/custom-models';
import { MODEL_CATALOG, getModel, type ModelConfig } from '../src/config/model';
import { createModelRegistry } from '../src/state/model-registry';

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  } as Storage;
}

const CUSTOM: ModelConfig = {
  id: 'custom:owner/name',
  modelId: 'owner/name',
  name: 'name',
  tradeoff: 'Added by you',
  summary: 'Loaded straight from the owner/name repository on Hugging Face.',
  webgpuDtype: 'q4f16',
  wasmDtype: 'q4',
  approximateDownloadMb: 600,
  custom: true,
};

describe('custom model store', () => {
  it('starts empty', () => {
    expect(createCustomModelStore(fakeStorage()).list()).toEqual([]);
  });

  it('round-trips a model through storage', () => {
    const storage = fakeStorage();
    createCustomModelStore(storage).add(CUSTOM);
    expect(createCustomModelStore(storage).list()).toEqual([CUSTOM]);
  });

  it('replaces an entry added twice rather than duplicating it', () => {
    const store = createCustomModelStore(fakeStorage());
    store.add(CUSTOM);
    store.add({ ...CUSTOM, approximateDownloadMb: 700 });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.approximateDownloadMb).toBe(700);
  });

  it('removes an entry', () => {
    const store = createCustomModelStore(fakeStorage());
    store.add(CUSTOM);
    store.remove(CUSTOM.id);
    expect(store.list()).toEqual([]);
  });

  it('ignores stored junk rather than throwing', () => {
    expect(createCustomModelStore(fakeStorage({ [CUSTOM_MODELS_KEY]: 'not json' })).list()).toEqual([]);
    expect(createCustomModelStore(fakeStorage({ [CUSTOM_MODELS_KEY]: '[{"id":1}]' })).list()).toEqual([]);
  });

  it('survives storage that throws on every access', () => {
    const hostile = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    const store = createCustomModelStore(hostile);
    expect(store.list()).toEqual([]);
    store.add(CUSTOM);
    // The choice still applies this session even though nothing was written.
    expect(store.list()).toEqual([CUSTOM]);
  });
});

describe('model registry', () => {
  beforeEach(() => createModelRegistry(createCustomModelStore(fakeStorage())));

  it('lists the built-ins first, then the custom models', () => {
    const registry = createModelRegistry(createCustomModelStore(fakeStorage()));
    registry.add(CUSTOM);
    const listed = registry.list();
    expect(listed.slice(0, MODEL_CATALOG.length)).toEqual([...MODEL_CATALOG]);
    expect(listed.at(-1)).toEqual(CUSTOM);
  });

  it('resolves a custom id that the plain catalog cannot', () => {
    const registry = createModelRegistry(createCustomModelStore(fakeStorage()));
    registry.add(CUSTOM);
    expect(registry.get(CUSTOM.id)).toEqual(CUSTOM);
    // The bare catalog lookup falls back to the default, which is why the registry exists.
    expect(getModel(CUSTOM.id).id).not.toBe(CUSTOM.id);
  });

  it('falls back to the default model for an unknown id', () => {
    const registry = createModelRegistry(createCustomModelStore(fakeStorage()));
    expect(registry.get('custom:nope/nope').id).toBe(MODEL_CATALOG[0]!.id);
  });

  it('reports whether an id is already known', () => {
    const registry = createModelRegistry(createCustomModelStore(fakeStorage()));
    expect(registry.has(CUSTOM.id)).toBe(false);
    registry.add(CUSTOM);
    expect(registry.has(CUSTOM.id)).toBe(true);
  });

  it('removes a custom model but never a built-in', () => {
    const registry = createModelRegistry(createCustomModelStore(fakeStorage()));
    registry.add(CUSTOM);
    registry.remove(CUSTOM.id);
    expect(registry.has(CUSTOM.id)).toBe(false);
    registry.remove(MODEL_CATALOG[0]!.id);
    expect(registry.has(MODEL_CATALOG[0]!.id)).toBe(true);
  });
});
