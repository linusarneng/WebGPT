/// <reference lib="webworker" />
import {
  env,
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
  type Chat,
  type TextGenerationPipeline,
} from '@huggingface/transformers';
import { GENERATION, getModel, type ModelConfig, type ModelId } from '../config/model';
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
/** The model the resident pipeline was built from. */
let active: ModelConfig | undefined;
const stoppers = new Map<string, InterruptableStoppingCriteria>();

/** Releases the resident pipeline before another one is built beside it. */
async function release(): Promise<void> {
  const previous = generator;
  generator = undefined;
  active = undefined;
  backend = undefined;
  stoppers.clear();
  try {
    await previous?.dispose();
  } catch {
    /* A pipeline that cannot be disposed is still dropped from this worker. */
  }
}

async function initialize(id: ModelId): Promise<void> {
  const model = getModel(id);
  if (generator && active?.id === model.id) {
    emit({
      type: 'ready',
      backend: backend!,
      model: model.id,
      ...(backend === 'wasm' ? { warning: WASM_WARNING } : {}),
    });
    return;
  }
  // A different model means the previous pipeline goes first: one at a time.
  if (generator) await release();
  // Coalesce concurrent initialize commands onto one download.
  loading ??= loadPipeline(model).finally(() => {
    loading = undefined;
  });
  return loading;
}

const WASM_WARNING =
  'WebGPU is unavailable, so WebGPT is running on the CPU (WASM). Replies will be noticeably slower.';

async function loadPipeline(model: ModelConfig): Promise<void> {
  emit({ type: 'status', status: 'loading', phase: 'checking', detail: 'Checking device' });
  const detected = await detectBackend();
  const dtype = detected === 'webgpu' ? model.webgpuDtype : model.wasmDtype;

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
    generator = await createTextGenerationPipeline('text-generation', model.modelId, options);
  } catch (error) {
    generator = undefined;
    emit({ type: 'error', code: 'load-failed', message: describe(error) });
    return;
  }

  backend = detected;
  active = model;
  emit({ type: 'status', status: 'loading', phase: 'preparing', detail: 'Preparing model' });
  emit({
    type: 'ready',
    backend: detected,
    model: model.id,
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
    token_callback_function: (tokens: bigint[]) => {
      // This callback is tokenizer-level ground truth; text chunks are not tokens.
      if (tokens.length) emit({ type: 'token-count', requestId, count: tokens.length });
    },
  });

  try {
    await generator(messages, {
      max_new_tokens: GENERATION.maxNewTokens,
      temperature: GENERATION.temperature,
      top_p: GENERATION.topP,
      do_sample: GENERATION.temperature > 0,
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
      void initialize(command.model);
      break;
    case 'generate':
      void generate(command.requestId, command.messages as Chat);
      break;
    case 'abort':
      stoppers.get(command.requestId)?.interrupt();
      break;
    case 'dispose':
      void release();
      break;
  }
});
