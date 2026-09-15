import type { InferenceProviderStatus } from '@varve/engine/nativeAcceleration';
import { describe, expect, it } from 'vitest';

import { inferencePlacementLabel, npuPlacementLabel } from './nativeAccelerationPanelLabels';

function provider(overrides: Partial<InferenceProviderStatus> = {}): InferenceProviderStatus {
  return {
    id: 'webgpu',
    label: 'WebGPU (Dawn)',
    deviceKind: 'gpu',
    stage: 'deviceUsable',
    reason: null,
    detail: null,
    ...overrides,
  };
}

describe('NativeAccelerationPanel diagnostics labels', () => {
  it('does not call a registered GPU provider verified before it runs a model', () => {
    expect(inferencePlacementLabel([provider()])).toContain(
      'graph partitioning remains unprofiled',
    );
  });

  it('reports provider execution without overstating graph placement', () => {
    expect(inferencePlacementLabel([provider({ stage: 'executionVerified' })])).toContain(
      'graph placement is not profiled',
    );
  });

  it('keeps missing NPU runtimes explicit and leaves CPU fallback visible', () => {
    expect(
      npuPlacementLabel([
        provider({
          id: 'qnn',
          label: 'QNN (Qualcomm NPU)',
          deviceKind: 'npu',
          stage: 'unavailable',
          reason: 'artifactMissing',
        }),
      ]),
    ).toContain('CPU fallback remains available');
  });
});
