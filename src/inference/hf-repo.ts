/**
 * Turns a pasted Hugging Face link into a model WebGPT can actually run.
 *
 * Only the repo's published files can be checked from here, so this answers one
 * question honestly: does this repo carry ONNX weights and a chat template? A
 * repo that passes can still fail later inside onnxruntime on an architecture
 * it does not implement; that is handled by the normal load-error path.
 */
import type { Dtype, ModelConfig } from '../config/model';

/** The slice of `fetch` this module needs, so tests can supply a double. */
export type HfFetch = (url: string, init?: { method?: string }) => Promise<Response>;

export type RepoProbeResult =
  | { ok: true; model: ModelConfig }
  | { ok: false; reason: string };

const HF_HOSTS = new Set(['huggingface.co', 'www.huggingface.co', 'hf.co']);
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Accepts `owner/name`, a model page URL, or a URL pointing deeper into the repo,
 * and reduces all of them to `owner/name`.
 */
export function parseRepoId(input: string): string | undefined {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;

  let path = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return undefined;
    }
    if (!HF_HOSTS.has(url.hostname.toLowerCase())) return undefined;
    path = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  }

  const segments = path.split('/');
  // A page URL carries extra segments (`/tree/main/...`); a bare id must not.
  if (segments.length > 2 && path === trimmed) return undefined;
  const [owner, name] = segments;
  if (!owner || !name || !SEGMENT.test(owner) || !SEGMENT.test(name)) return undefined;
  return `${owner}/${name}`;
}

/**
 * Weight-file suffixes mapped to the dtype name Transformers.js expects, in the
 * order each backend should prefer them. WebGPU can use half precision; the WASM
 * fallback runs integer quantisations instead.
 */
const DTYPE_FILES: ReadonlyArray<{ suffix: string; dtype: Dtype }> = [
  { suffix: '_q4f16', dtype: 'q4f16' },
  { suffix: '_fp16', dtype: 'fp16' },
  { suffix: '_q4', dtype: 'q4' },
  { suffix: '_bnb4', dtype: 'q4' },
  { suffix: '_quantized', dtype: 'q8' },
  { suffix: '_int8', dtype: 'int8' },
  { suffix: '_uint8', dtype: 'q8' },
  { suffix: '', dtype: 'fp32' },
];

const WEBGPU_ORDER: readonly Dtype[] = ['q4f16', 'fp16', 'q4', 'q8', 'int8', 'fp32'];
const WASM_ORDER: readonly Dtype[] = ['q4', 'q8', 'int8', 'q4f16', 'fp32', 'fp16'];

interface WeightFile {
  path: string;
  dtype: Dtype;
}

/** Reads the repo's ONNX weight files and the dtype each one represents. */
function weightFiles(files: readonly string[]): WeightFile[] {
  const found: WeightFile[] = [];
  for (const path of files) {
    if (!path.endsWith('.onnx')) continue;
    const stem = path.slice(0, -'.onnx'.length);
    // Longest suffix first, so `_q4f16` is never read as `_q4`.
    const match = [...DTYPE_FILES]
      .sort((a, b) => b.suffix.length - a.suffix.length)
      .find((candidate) => candidate.suffix === '' || stem.endsWith(candidate.suffix));
    if (match) found.push({ path, dtype: match.dtype });
  }
  return found;
}

function pick(available: readonly WeightFile[], order: readonly Dtype[]): WeightFile | undefined {
  for (const dtype of order) {
    const match = available.find((file) => file.dtype === dtype);
    if (match) return match;
  }
  return available[0];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed.';
}

/** Checks one repo against everything WebGPT needs before offering to load it. */
export async function probeRepo(repoId: string, hfFetch: HfFetch = fetch): Promise<RepoProbeResult> {
  const base = `https://huggingface.co/${repoId}`;

  let files: string[];
  try {
    const response = await hfFetch(`https://huggingface.co/api/models/${repoId}`);
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'That repository was not found, or it is private.' };
    }
    if (!response.ok) {
      return { ok: false, reason: `Hugging Face answered with status ${response.status}.` };
    }
    const payload = (await response.json()) as { siblings?: { rfilename?: string }[] };
    files = (payload.siblings ?? [])
      .map((sibling) => sibling.rfilename)
      .filter((name): name is string => typeof name === 'string');
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }

  const weights = weightFiles(files);
  if (weights.length === 0) {
    return {
      ok: false,
      reason: 'This repository publishes no ONNX weights, so it cannot run in a browser.',
    };
  }

  try {
    const response = await hfFetch(`${base}/resolve/main/tokenizer_config.json`);
    if (!response.ok) {
      return { ok: false, reason: 'This repository has no tokenizer configuration.' };
    }
    const config = (await response.json()) as { chat_template?: unknown };
    if (!config.chat_template) {
      return {
        ok: false,
        reason: 'This repository has no chat template, so it is a base model rather than an instruct model.',
      };
    }
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }

  const webgpu = pick(weights, WEBGPU_ORDER)!;
  const wasm = pick(weights, WASM_ORDER)!;

  return {
    ok: true,
    model: {
      id: `custom:${repoId}`,
      modelId: repoId,
      name: repoId.split('/')[1]!,
      tradeoff: 'Added by you',
      summary: `Loaded straight from the ${repoId} repository on Hugging Face.`,
      webgpuDtype: webgpu.dtype,
      wasmDtype: wasm.dtype,
      approximateDownloadMb: await weightSize(`${base}/resolve/main/${webgpu.path}`, hfFetch),
      custom: true,
    },
  };
}

/** The real size of the weight file, or nothing if the server will not say. */
async function weightSize(url: string, hfFetch: HfFetch): Promise<number | undefined> {
  try {
    const response = await hfFetch(url, { method: 'HEAD' });
    if (!response.ok) return undefined;
    const length = Number(response.headers.get('content-length'));
    if (!Number.isFinite(length) || length <= 0) return undefined;
    return Math.round(length / (1024 * 1024));
  } catch {
    return undefined;
  }
}
