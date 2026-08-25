import { describe, expect, it } from 'vitest';
import {
  createBrowserMetricsCollector,
  createGenerationTelemetry,
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
