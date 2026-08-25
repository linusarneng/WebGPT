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

export interface SparklineModel {
  state: 'data' | 'empty' | 'unavailable';
  path: string;
  valueCount: number;
}

/** Converts only observed values into a compact SVG path for the technical panel. */
export function createSparklineModel(values: readonly number[] | undefined): SparklineModel {
  if (values === undefined) return { state: 'unavailable', path: '', valueCount: 0 };
  const samples = values.filter((value) => Number.isFinite(value));
  if (samples.length === 0) return { state: 'empty', path: '', valueCount: 0 };

  const minimum = Math.min(...samples);
  const maximum = Math.max(...samples);
  const span = maximum - minimum;
  const point = (value: number, index: number): string => {
    const x = samples.length === 1 ? 0 : (index / (samples.length - 1)) * 100;
    const y = span === 0 ? 12 : 24 - ((value - minimum) / span) * 24;
    return `${x} ${y}`;
  };
  const first = samples.length === 1 ? '50 12' : point(samples[0]!, 0);
  const path = samples.length === 1
    ? `M ${first} L ${first}`
    : samples.map((value, index) => `${index === 0 ? 'M' : 'L'} ${point(value, index)}`).join(' ');
  return { state: 'data', path, valueCount: samples.length };
}
