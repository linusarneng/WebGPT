export interface GenerationStats {
  tokenCount: number;
  elapsedMs: number;
  tokensPerSecond: number | undefined;
  generating: boolean;
}

/** Counts only tokenizer callback IDs, never display chunks or words. */
export function createGenerationTelemetry() {
  let startedAt: number | undefined;
  let finishedAt: number | undefined;
  let tokenCount = 0;

  function snapshot(now: number): GenerationStats {
    if (startedAt === undefined) {
      return { tokenCount: 0, elapsedMs: 0, tokensPerSecond: undefined, generating: false };
    }
    const end = finishedAt ?? now;
    const elapsedMs = Math.max(0, end - startedAt);
    return {
      tokenCount,
      elapsedMs,
      tokensPerSecond: elapsedMs > 0 && tokenCount > 0 ? tokenCount / (elapsedMs / 1_000) : undefined,
      generating: finishedAt === undefined,
    };
  }

  return {
    start(now: number): void {
      startedAt = now;
      finishedAt = undefined;
      tokenCount = 0;
    },
    recordTokens(count: number, _now: number): void {
      tokenCount += Math.max(0, count);
    },
    finish(now: number): void {
      if (startedAt !== undefined) finishedAt = now;
    },
    snapshot,
  };
}

export interface BrowserMetrics {
  secureContext: boolean;
  webgpu: 'Available' | 'Not exposed by this browser';
  heapUsed: number | undefined;
  heapLimit: number | undefined;
  deviceMemory: number | undefined;
  cpuCores: number | undefined;
  gpuAdapter: string;
}

type BrowserSource = {
  isSecureContext: boolean;
  navigator: {
    gpu?: unknown;
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  performance: {
    memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
  };
};

/** Small adapter around non-standard browser surfaces, with no guessed values. */
export function createBrowserMetricsCollector(source: BrowserSource = globalThis as unknown as BrowserSource) {
  return {
    collect(): BrowserMetrics {
      const memory = source.performance.memory;
      return {
        secureContext: source.isSecureContext,
        webgpu: source.navigator.gpu ? 'Available' : 'Not exposed by this browser',
        heapUsed: memory?.usedJSHeapSize,
        heapLimit: memory?.jsHeapSizeLimit,
        deviceMemory: source.navigator.deviceMemory,
        cpuCores: source.navigator.hardwareConcurrency,
        gpuAdapter: 'Not exposed by this browser',
      };
    },
  };
}

export function formatBrowserMetric(value: number | undefined): string {
  return value === undefined ? 'Not exposed by this browser' : String(value);
}

export function formatBytes(value: number | undefined): string {
  if (value === undefined) return 'Not exposed by this browser';
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export function formatDuration(ms: number): string {
  return `${(ms / 1_000).toFixed(1)} s`;
}

export function formatRate(rate: number | undefined): string {
  return rate === undefined ? 'No generation yet' : `${rate.toFixed(1)} tok/s`;
}
