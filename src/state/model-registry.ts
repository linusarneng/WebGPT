import { getDefaultModel, MODEL_CATALOG, type ModelConfig, type ModelId } from '../config/model';
import type { CustomModelStore } from '../storage/custom-models';

export interface ModelRegistry {
  /** Built-ins first, in catalog order, then the models the user added. */
  list(): ModelConfig[];
  /** Resolves any id, falling back to the default model like `getModel` does. */
  get(id: ModelId | undefined): ModelConfig;
  has(id: ModelId): boolean;
  add(model: ModelConfig): void;
  /** Removing a built-in is a no-op; only custom entries can be dropped. */
  remove(id: ModelId): void;
}

/**
 * The single place that knows every model this browser can choose from. The
 * catalog in `config/model.ts` stays a static list of what WebGPT ships; the
 * registry layers the user's own repos on top of it.
 */
export function createModelRegistry(store: CustomModelStore): ModelRegistry {
  let custom = store.list();

  return {
    list: () => [...MODEL_CATALOG, ...custom],
    get(id) {
      return (
        MODEL_CATALOG.find((model) => model.id === id) ??
        custom.find((model) => model.id === id) ??
        getDefaultModel()
      );
    },
    has(id) {
      return MODEL_CATALOG.some((model) => model.id === id) || custom.some((model) => model.id === id);
    },
    add(model) {
      store.add(model);
      custom = store.list();
    },
    remove(id) {
      if (MODEL_CATALOG.some((model) => model.id === id)) return;
      store.remove(id);
      custom = store.list();
    },
  };
}
