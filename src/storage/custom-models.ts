import type { Dtype, ModelConfig } from '../config/model';

export const CUSTOM_MODELS_KEY = 'webgpt.customModels';

export interface CustomModelStore {
  list(): ModelConfig[];
  add(model: ModelConfig): void;
  remove(id: string): void;
}

const DTYPES = new Set<Dtype>(['q4f16', 'fp16', 'q4', 'q8', 'int8', 'fp32']);

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    // Some privacy modes throw on the property access itself.
    return undefined;
  }
}

/** Accepts only entries that still match the shape the rest of the app expects. */
function parse(raw: string | null): ModelConfig[] {
  if (!raw) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(payload)) return [];
  return payload.filter((entry): entry is ModelConfig => {
    if (typeof entry !== 'object' || entry === null) return false;
    const model = entry as Partial<ModelConfig>;
    return (
      typeof model.id === 'string' &&
      typeof model.modelId === 'string' &&
      typeof model.name === 'string' &&
      typeof model.tradeoff === 'string' &&
      typeof model.summary === 'string' &&
      DTYPES.has(model.webgpuDtype as Dtype) &&
      DTYPES.has(model.wasmDtype as Dtype) &&
      (model.approximateDownloadMb === undefined || typeof model.approximateDownloadMb === 'number')
    );
  });
}

/**
 * The models the user added themselves, kept in `localStorage` beside the model
 * preference. Blocked storage degrades to an in-memory list for the session,
 * matching how the model preference behaves.
 */
export function createCustomModelStore(
  storage: Storage | undefined = safeStorage(),
): CustomModelStore {
  let models: ModelConfig[] = [];
  try {
    models = parse(storage?.getItem(CUSTOM_MODELS_KEY) ?? null);
  } catch {
    /* Reading can throw; an empty list stands. */
  }

  function persist(): void {
    try {
      storage?.setItem(CUSTOM_MODELS_KEY, JSON.stringify(models));
    } catch {
      /* Writing can throw; the in-memory list still applies this session. */
    }
  }

  return {
    list: () => [...models],
    add(model) {
      // Re-adding the same repo refreshes it rather than stacking duplicates.
      models = [...models.filter((existing) => existing.id !== model.id), model];
      persist();
    },
    remove(id) {
      models = models.filter((model) => model.id !== id);
      persist();
    },
  };
}
