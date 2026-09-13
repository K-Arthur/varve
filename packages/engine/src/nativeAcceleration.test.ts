import { describe, expect, it } from 'vitest';

import {
  describeAccelStage,
  getNativeAccelerationStatus,
  isNativeAccelerationAvailable,
  isNativeGpuComputeUsable,
  nativeAccelerationClearCache,
  runNativeGpuSelfTest,
} from './nativeAcceleration';

describe('nativeAcceleration contract', () => {
  it('reports unavailable and returns null outside Tauri', async () => {
    expect(isNativeAccelerationAvailable()).toBe(false);
    expect(await getNativeAccelerationStatus()).toBeNull();
    expect(await runNativeGpuSelfTest()).toBeNull();
    expect(await isNativeGpuComputeUsable()).toBe(false);
  });

  it('labels every acceleration stage for diagnostics surfaces', () => {
    const stages = [
      'unknown',
      'discovered',
      'runtimeLoadable',
      'deviceUsable',
      'executionVerified',
      'unavailable',
    ] as const;
    for (const stage of stages) {
      expect(describeAccelStage(stage).length).toBeGreaterThan(0);
    }
  });

  it('clears its cache without throwing', () => {
    expect(() => nativeAccelerationClearCache()).not.toThrow();
  });
});
