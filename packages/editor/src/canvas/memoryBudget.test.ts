/**
 * Pressure-profile resolution (finding F6): the runtime profile resolves
 * deterministically from platform memory hints, and the tightened budgets
 * apply to every cache including the raster pyramid and the retained
 * surface (F2). The resolver must never throw or return an unknown value.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePressureBudgets, resolveRuntimePressureProfile } from './memoryBudget';

const NAV = globalThis.navigator as unknown as { deviceMemory?: number };

function stubDeviceMemory(value: number | undefined): void {
  Object.defineProperty(NAV, 'deviceMemory', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  stubDeviceMemory(undefined);
  Object.defineProperty(NAV, 'deviceMemory', { configurable: true, value: undefined });
});

describe('resolveRuntimePressureProfile', () => {
  it('resolves normal for high-memory machines', () => {
    stubDeviceMemory(8);
    expect(resolveRuntimePressureProfile()).toBe('normal');
    stubDeviceMemory(16);
    expect(resolveRuntimePressureProfile()).toBe('normal');
  });

  it('resolves 4gb for 4 GB devices', () => {
    stubDeviceMemory(4);
    expect(resolveRuntimePressureProfile()).toBe('4gb');
  });

  it('resolves 2gb for 2 GB and below', () => {
    stubDeviceMemory(2);
    expect(resolveRuntimePressureProfile()).toBe('2gb');
    stubDeviceMemory(1);
    expect(resolveRuntimePressureProfile()).toBe('2gb');
    stubDeviceMemory(0.5);
    expect(resolveRuntimePressureProfile()).toBe('2gb');
  });

  it('falls back to normal when deviceMemory is absent or invalid', () => {
    stubDeviceMemory(undefined);
    expect(resolveRuntimePressureProfile()).toBe('normal');
    stubDeviceMemory(NaN);
    expect(resolveRuntimePressureProfile()).toBe('normal');
  });
});

describe('resolvePressureBudgets', () => {
  it('tightens every budget monotonically with pressure', () => {
    for (const profile of ['normal', '4gb', '2gb'] as const) {
      const b = resolvePressureBudgets(profile);
      expect(b.workerBitmapBytes).toBeGreaterThanOrEqual(b.subtreeIrCacheBytes);
      expect(b.imageCacheBytes).toBeGreaterThanOrEqual(b.subtreeIrCacheBytes);
    }
    const normal = resolvePressureBudgets('normal');
    const g4 = resolvePressureBudgets('4gb');
    const g2 = resolvePressureBudgets('2gb');
    expect(g2.workerBitmapBytes).toBeLessThan(g4.workerBitmapBytes);
    expect(g4.workerBitmapBytes).toBeLessThan(normal.workerBitmapBytes);
    expect(g2.imageCacheBytes).toBeLessThan(g4.imageCacheBytes);
  });

  it('returns the defaults for normal', () => {
    expect(resolvePressureBudgets('normal')).toBe(resolvePressureBudgets('normal'));
  });
});
