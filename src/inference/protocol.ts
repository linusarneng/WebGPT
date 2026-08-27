import type { ChatMessage, ModelConfig, ModelId } from '../config/model';

export type Backend = 'webgpu' | 'wasm';

export type RuntimeStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Named stages of a model load, so the UI can narrate progress honestly. */
export type LoadPhase = 'checking' | 'downloading' | 'preparing' | 'ready';

export type ErrorCode = 'load-failed' | 'generation-failed' | 'unsupported' | 'worker-crashed';

/** Main thread → worker. */
export type WorkerCommand =
  /** The whole config travels, so the worker never has to resolve an id itself. */
  | { type: 'initialize'; model: ModelConfig }
  | { type: 'generate'; requestId: string; messages: ChatMessage[] }
  | { type: 'abort'; requestId: string }
  | { type: 'dispose' };

/** Worker → main thread. */
export type WorkerEvent =
  | { type: 'status'; status: RuntimeStatus; detail?: string; phase?: LoadPhase }
  | { type: 'progress'; file: string; loaded?: number; total?: number; progress?: number }
  | { type: 'ready'; backend: Backend; model: ModelId; warning?: string }
  | { type: 'token'; requestId: string; text: string }
  /** Exact generated token ids from Transformers.js' tokenizer callback. */
  | { type: 'token-count'; requestId: string; count: number }
  | { type: 'complete'; requestId: string; text: string }
  | { type: 'aborted'; requestId: string; text: string }
  | { type: 'error'; requestId?: string; code: ErrorCode; message: string };

export interface GenerateRequest {
  requestId: string;
  messages: ChatMessage[];
}

export type GenerationResult =
  | { outcome: 'complete'; text: string }
  | { outcome: 'stopped'; text: string }
  | { outcome: 'error'; text: string; error: string };
