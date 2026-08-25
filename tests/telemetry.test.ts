import { describe, expect, it } from 'vitest';
import {
  createBrowserMetricsCollector,
  createGenerationTelemetry,
  createSparklineModel,
  formatBrowserMetric,
} from '../src/telemetry/runtime-telemetry';

describe('generation telemetry', () => {
  it('counts real token callbacks and calculates elapsed output rate from callback timestamps', () => {
    const telemetry = createGenerationTelemetry();

    telemetry.start(1_000);
    telemetry.recordTokens(3, 1_500);
    telemetry.recordTokens(2, 2_000);

    expect(telemetry.snapshot(2_000)).toEqual({
      tokenCount: 5,
      elapsedMs: 1_000,
      tokensPerSecond: 5,
      generating: true,
    });
  });

  it('reports idle without inventing a token rate before a response starts', () => {
    expect(createGenerationTelemetry().snapshot(5_000)).toEqual({
      tokenCount: 0,
      elapsedMs: 0,
      tokensPerSecond: undefined,
      generating: false,
    });
  });

  it('keeps the last completed response statistics after generation ends', () => {
    const telemetry = createGenerationTelemetry();
    telemetry.start(100);
    telemetry.recordTokens(4, 1_100);
    telemetry.finish(2_100);

    expect(telemetry.snapshot(2_500)).toEqual({
      tokenCount: 4,
      elapsedMs: 2_000,
      tokensPerSecond: 2,
      generating: false,
    });
  });
});

describe('browser metrics', () => {
  it('uses explicit unavailable wording for browser APIs that are not exposed', () => {
    const collector = createBrowserMetricsCollector({
      isSecureContext: false,
      navigator: {},
      performance: {},
    });

    expect(collector.collect()).toEqual({
      secureContext: false,
      webgpu: 'Not exposed by this browser',
      heapUsed: undefined,
      heapLimit: undefined,
      deviceMemory: undefined,
      cpuCores: undefined,
      gpuAdapter: 'Not exposed by this browser',
    });
    expect(formatBrowserMetric(undefined)).toBe('Not exposed by this browser');
  });

  it('collects only browser-exposed browser and heap values', () => {
    const collector = createBrowserMetricsCollector({
      isSecureContext: true,
      navigator: { gpu: {}, deviceMemory: 8, hardwareConcurrency: 12 },
      performance: { memory: { usedJSHeapSize: 1_500_000, jsHeapSizeLimit: 4_000_000 } },
    });

    expect(collector.collect()).toMatchObject({
      secureContext: true,
      webgpu: 'Available',
      heapUsed: 1_500_000,
      heapLimit: 4_000_000,
      deviceMemory: 8,
      cpuCores: 12,
    });
  });
});

describe('sparkline telemetry models', () => {
  it('renders a neutral empty model instead of inventing a line without samples', () => {
    expect(createSparklineModel([])).toEqual({ state: 'empty', path: '', valueCount: 0 });
  });

  it('creates a finite, visible path for one or more real samples', () => {
    expect(createSparklineModel([12])).toEqual({ state: 'data', path: 'M 50 12 L 50 12', valueCount: 1 });
    expect(createSparklineModel([10, 20, 15])).toEqual({
      state: 'data',
      path: 'M 0 24 L 50 0 L 100 12',
      valueCount: 3,
    });
  });

  it('keeps unavailable browser metrics visibly unsupported rather than charting guessed data', () => {
    expect(createSparklineModel(undefined)).toEqual({ state: 'unavailable', path: '', valueCount: 0 });
  });
});
