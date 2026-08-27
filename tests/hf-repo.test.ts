import { describe, expect, it } from 'vitest';
import { parseRepoId, probeRepo, type HfFetch } from '../src/inference/hf-repo';

describe('parseRepoId', () => {
  it('accepts a bare repo id', () => {
    expect(parseRepoId('onnx-community/Qwen3-0.6B-ONNX')).toBe('onnx-community/Qwen3-0.6B-ONNX');
  });

  it('accepts a model page URL', () => {
    expect(parseRepoId('https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX')).toBe(
      'onnx-community/Qwen3-0.6B-ONNX',
    );
  });

  it('accepts a URL that points deeper into the repo', () => {
    expect(parseRepoId('https://huggingface.co/owner/name/tree/main/onnx')).toBe('owner/name');
    expect(parseRepoId('https://huggingface.co/owner/name/blob/main/config.json')).toBe('owner/name');
  });

  it('trims whitespace and a trailing slash', () => {
    expect(parseRepoId('  owner/name/  ')).toBe('owner/name');
  });

  it('rejects input that is not a repo id', () => {
    expect(parseRepoId('')).toBeUndefined();
    expect(parseRepoId('justaname')).toBeUndefined();
    expect(parseRepoId('too/many/segments')).toBeUndefined();
    expect(parseRepoId('https://example.com/owner/name')).toBeUndefined();
  });
});

/** Builds a fetch double over a small description of a repo. */
function fakeHf(options: {
  files?: string[];
  missing?: boolean;
  chatTemplate?: boolean;
  bytes?: number;
  headFails?: boolean;
}): HfFetch {
  return async (url, init) => {
    if (url.includes('/api/models/')) {
      if (options.missing) return { ok: false, status: 404 } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({ siblings: (options.files ?? []).map((rfilename) => ({ rfilename })) }),
      } as Response;
    }
    if (url.endsWith('tokenizer_config.json')) {
      return {
        ok: options.chatTemplate !== undefined,
        status: options.chatTemplate === undefined ? 404 : 200,
        json: async () => (options.chatTemplate ? { chat_template: '{{ messages }}' } : {}),
      } as Response;
    }
    // HEAD on the weight file.
    expect(init?.method).toBe('HEAD');
    if (options.headFails) return { ok: false, status: 500, headers: new Headers() } as Response;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(options.bytes ?? 0) }),
    } as Response;
  };
}

const FULL = ['config.json', 'tokenizer_config.json', 'onnx/model_q4f16.onnx', 'onnx/model_q4.onnx'];

describe('probeRepo', () => {
  it('accepts a repo with ONNX weights and a chat template', async () => {
    const result = await probeRepo('owner/name', fakeHf({ files: FULL, chatTemplate: true, bytes: 600 * 1024 * 1024 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.modelId).toBe('owner/name');
    expect(result.model.id).toBe('custom:owner/name');
    expect(result.model.name).toBe('name');
    expect(result.model.webgpuDtype).toBe('q4f16');
    expect(result.model.wasmDtype).toBe('q4');
    expect(result.model.approximateDownloadMb).toBe(600);
  });

  it('picks the best dtype actually published by the repo', async () => {
    const result = await probeRepo(
      'owner/name',
      fakeHf({ files: ['tokenizer_config.json', 'onnx/model_fp16.onnx', 'onnx/model_quantized.onnx'], chatTemplate: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.webgpuDtype).toBe('fp16');
    expect(result.model.wasmDtype).toBe('q8');
  });

  it('reports a missing or private repo', async () => {
    const result = await probeRepo('owner/name', fakeHf({ missing: true }));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.reason).toMatch(/not found|private/i);
  });

  it('reports a repo with no ONNX weights', async () => {
    const result = await probeRepo('owner/name', fakeHf({ files: ['config.json', 'model.safetensors'], chatTemplate: true }));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.reason).toMatch(/ONNX/i);
  });

  it('reports a base model with no chat template', async () => {
    const result = await probeRepo('owner/name', fakeHf({ files: FULL, chatTemplate: false }));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.reason).toMatch(/chat template|instruct/i);
  });

  it('still accepts the repo when the size cannot be read', async () => {
    const result = await probeRepo('owner/name', fakeHf({ files: FULL, chatTemplate: true, headFails: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.approximateDownloadMb).toBeUndefined();
  });

  it('surfaces a network failure as a readable reason', async () => {
    const result = await probeRepo('owner/name', async () => {
      throw new Error('offline');
    });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.reason).toMatch(/offline/i);
  });
});
