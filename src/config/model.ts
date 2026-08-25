/**
 * Single source of truth for which model WebGPT runs and how it is prompted.
 * Swapping models should only require edits in this file.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelConfig {
  /** Hugging Face repo id. Verified to publish ONNX weights for browser use. */
  readonly modelId: string;
  /** Quantisation used when WebGPU is available. */
  readonly webgpuDtype: 'q4f16' | 'fp16' | 'q4';
  /** Quantisation used on the slower WASM fallback path. */
  readonly wasmDtype: 'q4' | 'q8' | 'int8';
  readonly systemPrompt: string;
  readonly maxNewTokens: number;
  readonly temperature: number;
  readonly topP: number;
  /**
   * How many trailing conversation messages are replayed to the model.
   * The system prompt is always kept on top of this budget.
   */
  readonly maxHistoryMessages: number;
  /** Approximate download size, shown before the user opts into the download. */
  readonly approximateDownloadMb: number;
}

export const MODEL_CONFIG: ModelConfig = {
  modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
  webgpuDtype: 'q4f16',
  wasmDtype: 'q4',
  systemPrompt:
    'You are WebGPT, a small assistant running entirely inside the user\'s web browser. ' +
    'Answer clearly and concisely. If you are unsure, say so rather than inventing details.',
  maxNewTokens: 512,
  temperature: 0.7,
  topP: 0.9,
  maxHistoryMessages: 12,
  approximateDownloadMb: 500,
};

/** Builds the bounded message list sent to the model for one generation. */
export function buildPromptMessages(history: readonly ChatMessage[]): ChatMessage[] {
  const recent = history.slice(-MODEL_CONFIG.maxHistoryMessages);
  return [{ role: 'system', content: MODEL_CONFIG.systemPrompt }, ...recent];
}
