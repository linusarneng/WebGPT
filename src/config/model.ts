/**
 * The curated catalog of models WebGPT can run, plus the generation settings
 * shared by all of them. Adding or retiring a model is an edit to this file
 * only; every other module resolves models through `getModel`.
 *
 * Every repo below publishes ONNX weights and is documented for Transformers.js
 * browser use. Sizes are the on-disk size of the WebGPU-path weight file in the
 * repo, rounded — not a benchmark or a promise about speed.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** The three models WebGPT ships with. Custom entries are ids too, hence `string`. */
export type BuiltinModelId = 'qwen2.5-0.5b-instruct' | 'granite-4.0-350m' | 'qwen3-0.6b';

/**
 * A model key. Built-ins use the ids above; a model the user added uses
 * `custom:<owner>/<name>`. It is a plain string because the set is open.
 */
export type ModelId = string;

/** Quantisations Transformers.js can be asked for. */
export type Dtype = 'q4f16' | 'fp16' | 'q4' | 'q8' | 'int8' | 'fp32';

export interface ModelConfig {
  /** Stable key used in the UI and in the stored preference. */
  readonly id: ModelId;
  /** Hugging Face repo id. Verified to publish ONNX weights for browser use. */
  readonly modelId: string;
  /** Human name, as a person would say it. */
  readonly name: string;
  /** The practical trade-off this option represents. */
  readonly tradeoff: string;
  /** One sentence on when to pick it. No benchmarks, no timings. */
  readonly summary: string;
  /** Quantisation used when WebGPU is available. */
  readonly webgpuDtype: Dtype;
  /** Quantisation used on the slower WASM fallback path. */
  readonly wasmDtype: Dtype;
  /**
   * Approximate first download, shown before the user opts into it. Undefined
   * when a custom repo would not report its weight size.
   */
  readonly approximateDownloadMb: number | undefined;
  /** True for a model the user added by repo id, rather than a shipped one. */
  readonly custom?: boolean;
}

/** Generation behaviour is a property of WebGPT, not of any one model. */
export const GENERATION = {
  systemPrompt:
    'You are WebGPT, a small assistant running entirely inside the user\'s web browser. ' +
    'Answer clearly and concisely. If you are unsure, say so rather than inventing details.',
  maxNewTokens: 512,
  temperature: 0.7,
  topP: 0.9,
  /**
   * How many trailing conversation messages are replayed to the model.
   * The system prompt is always kept on top of this budget.
   */
  maxHistoryMessages: 12,
} as const;

export const DEFAULT_MODEL_ID: BuiltinModelId = 'qwen3-0.6b';

export const MODEL_CATALOG: readonly ModelConfig[] = [
  {
    id: 'qwen3-0.6b',
    modelId: 'onnx-community/Qwen3-0.6B-ONNX',
    name: 'Qwen3 0.6B',
    tradeoff: 'Recommended',
    summary: 'The newest of the three, and the one with the most headroom on longer, harder prompts.',
    webgpuDtype: 'q4f16',
    wasmDtype: 'q4',
    approximateDownloadMb: 590,
  },
  {
    id: 'granite-4.0-350m',
    modelId: 'onnx-community/granite-4.0-350m-ONNX-web',
    name: 'Granite 4.0 350M',
    tradeoff: 'Smallest download',
    summary: 'IBM\'s compact instruct model: the quickest to fetch and the lightest to run.',
    webgpuDtype: 'q4f16',
    wasmDtype: 'q4',
    approximateDownloadMb: 360,
  },
  {
    id: 'qwen2.5-0.5b-instruct',
    modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    name: 'Qwen2.5 0.5B Instruct',
    tradeoff: 'Lighter alternative',
    summary: 'A smaller download that still handles general questions and short writing tasks.',
    webgpuDtype: 'q4f16',
    wasmDtype: 'q4',
    approximateDownloadMb: 500,
  },
];

/** True for a built-in id. Custom ids are validated by the registry instead. */
export function isModelId(value: unknown): value is ModelId {
  return MODEL_CATALOG.some((model) => model.id === value);
}

/** One phrase for a first download, whether or not the size is known. */
export function formatDownloadSize(model: ModelConfig): string {
  return model.approximateDownloadMb === undefined
    ? 'Download size not reported by the repository'
    : `~${model.approximateDownloadMb} MB first download`;
}

export function getDefaultModel(): ModelConfig {
  return MODEL_CATALOG.find((model) => model.id === DEFAULT_MODEL_ID)!;
}

/** Resolves any stored or messaged id, falling back to the default. */
export function getModel(id: string | null | undefined): ModelConfig {
  return MODEL_CATALOG.find((model) => model.id === id) ?? getDefaultModel();
}

/** Short model name for chips and headings, e.g. `Qwen2.5 0.5B Instruct`. */
export function shortName(model: ModelConfig): string {
  return model.name;
}

/** Builds the bounded message list sent to the model for one generation. */
export function buildPromptMessages(history: readonly ChatMessage[]): ChatMessage[] {
  const recent = history.slice(-GENERATION.maxHistoryMessages);
  return [{ role: 'system', content: GENERATION.systemPrompt }, ...recent];
}
