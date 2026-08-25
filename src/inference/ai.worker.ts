/// <reference lib="webworker" />
import {
  env,
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
  type Chat,
  type TextGenerationPipeline,
} from '@huggingface/transformers';
import { MODEL_CONFIG } from '../config/model';
import type { Backend, WorkerCommand, WorkerEvent } from './protocol';

// Model weights come from the Hugging Face CDN; nothing is served by an app backend.
env.allowLocalModels = false;

const scope = self as unknown as DedicatedWorkerGlobalScope;

function emit(event: WorkerEvent): void {
  scope.postMessage(event);
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}

async function detectBackend(): Promise<Backend> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return 'wasm';
  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

/**
 * `pipeline()`'s published signature is a union across every task, device and dtype,
 * which TypeScript cannot represent when instantiated. This narrow view of it keeps
 * the worker type-checkable while preserving the runtime behaviour.
 */
const createTextGenerationPipeline = pipeline as unknown as (
  task: 'text-generation',
  model: string,
  options: Record<string, unknown>,
) => Promise<TextGenerationPipeline>;

let generator: TextGenerationPipeline | undefined;
let loading: Promise<void> | undefined;
let backend: Backend | undefined;
const stoppers = new Map<string, InterruptableStoppingCriteria>();

async function initialize(): Promise<void> {
  if (generator) {
    emit({ type: 'ready', backend: backend!, modelId: MODEL_CONFIG.modelId, ...(backend === 'wasm' ? { warning: WASM_WARNING } : {}) });
    return;
  }
  // Coalesce concurrent initialize commands onto one download.
  loading ??= loadPipeline().finally(() => {
    loading = undefined;
  });
  return loading;
}

const WASM_WARNING =
  'WebGPU is unavailable, so WebGPT is running on the CPU (WASM). Replies will be noticeably slower.';

async function loadPipeline(): Promise<void> {
  emit({ type: 'status', status: 'loading', phase: 'checking', detail: 'Checking device' });
  const detected = await detectBackend();
  const dtype = detected === 'webgpu' ? MODEL_CONFIG.webgpuDtype : MODEL_CONFIG.wasmDtype;

  emit({ type: 'status', status: 'loading', phase: 'downloading', detail: 'Downloading model' });
  try {
    // The pipeline option type is a very large union; a narrow local type keeps
    // TypeScript from trying to represent every task/device/dtype combination.
    const options = {
      device: detected,
      dtype,
      progress_callback: (report: unknown) => {
        const item = report as { status?: string; file?: string; loaded?: number; total?: number; progress?: number };
        if (item.status === 'progress' && item.file) {
          emit({
            type: 'progress',
            file: item.file,
            loaded: item.loaded,
            total: item.total,
            progress: item.progress,
          });
        }
      },
    } as const;
    generator = await createTextGenerationPipeline('text-generation', MODEL_CONFIG.modelId, options);
  } catch (error) {
    generator = undefined;
    emit({ type: 'error', code: 'load-failed', message: describe(error) });
    return;
  }

  backend = detected;
  emit({ type: 'status', status: 'loading', phase: 'preparing', detail: 'Preparing model' });
  emit({
    type: 'ready',
    backend: detected,
    modelId: MODEL_CONFIG.modelId,
    ...(detected === 'wasm' ? { warning: WASM_WARNING } : {}),
  });
}

async function generate(requestId: string, messages: Chat): Promise<void> {
  if (!generator) {
    emit({ type: 'error', requestId, code: 'generation-failed', message: 'The local model is not loaded.' });
    return;
  }

  const stopper = new InterruptableStoppingCriteria();
  stoppers.set(requestId, stopper);

  let text = '';
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      if (!chunk) return;
      text += chunk;
      emit({ type: 'token', requestId, text: chunk });
    },
  });

  try {
    await generator(messages, {
      max_new_tokens: MODEL_CONFIG.maxNewTokens,
      temperature: MODEL_CONFIG.temperature,
      top_p: MODEL_CONFIG.topP,
      do_sample: MODEL_CONFIG.temperature > 0,
      return_full_text: false,
      streamer,
      // `stopping_criteria` is forwarded to `model.generate` but absent from the
      // pipeline's published option type, so it is passed through a cast.
      stopping_criteria: stopper,
    } as Parameters<typeof generator>[1]);
    // An interrupted run resolves normally, so the stop flag decides the outcome.
    if (stopper.interrupted) emit({ type: 'aborted', requestId, text });
    else emit({ type: 'complete', requestId, text });
  } catch (error) {
    // The worker stays alive so the user can retry without reloading the model.
    emit({ type: 'error', requestId, code: 'generation-failed', message: describe(error) });
  } finally {
    stoppers.delete(requestId);
  }
}

scope.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  switch (command.type) {
    case 'initialize':
      void initialize();
      break;
    case 'generate':
      void generate(command.requestId, command.messages as Chat);
      break;
    case 'abort':
      stoppers.get(command.requestId)?.interrupt();
      break;
    case 'dispose':
      generator = undefined;
      stoppers.clear();
      break;
  }
});
