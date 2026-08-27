import { DEFAULT_MODEL_ID, isModelId, type ModelId } from '../config/model';

export const MODEL_PREFERENCE_KEY = 'webgpt.model';

export interface ModelPreference {
  get(): ModelId;
  set(id: ModelId): void;
}

/** Decides whether a stored id still names a model this browser can load. */
export type KnownModel = (id: string) => boolean;

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    // Some privacy modes throw on the property access itself.
    return undefined;
  }
}

/**
 * Remembers the chosen model in `localStorage`, which is the right size of tool
 * for one short string. `isKnown` decides which stored ids survive a reload; the
 * app passes the model registry so custom repos are remembered too, while the
 * default only recognises the built-in catalog. Private mode and blocked storage degrade to an
 * in-memory value for the session: the choice still works, it just does not
 * survive a reload. Chat history lives in IndexedDB and is untouched either way.
 */
export function createModelPreference(
  storage: Storage | undefined = safeStorage(),
  isKnown: KnownModel = isModelId,
): ModelPreference {
  let current: ModelId = DEFAULT_MODEL_ID;
  try {
    const stored = storage?.getItem(MODEL_PREFERENCE_KEY);
    if (typeof stored === 'string' && isKnown(stored)) current = stored;
  } catch {
    /* Reading can throw; the default stands. */
  }

  return {
    get: () => current,
    set(id) {
      current = id;
      try {
        storage?.setItem(MODEL_PREFERENCE_KEY, id);
      } catch {
        /* Writing can throw; the in-memory choice still applies this session. */
      }
    },
  };
}
