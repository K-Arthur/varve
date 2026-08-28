import { describe, expect, it } from 'vitest';
import {
  AdaptiveResidencyManager,
  selectRasterRepresentation,
  shouldChangeRasterBucket,
} from './adaptiveResidency';

describe('adaptive render residency policy', () => {
  it('uses stable interactive resolution buckets and reserves full fidelity for output', () => {
    const moving = selectRasterRepresentation({
      viewportWidth: 1280,
      viewportHeight: 800,
      devicePixelRatio: 2,
      zoom: 0.2,
      cameraMoving: true,
    });
    expect(moving.maxSourceDim).toBe(1024);
    expect(moving.maxSourceDim & (moving.maxSourceDim - 1)).toBe(0);

    expect(
      selectRasterRepresentation({
        viewportWidth: 1280,
        viewportHeight: 800,
        devicePixelRatio: 2,
        zoom: 1,
        intent: 'export',
      }).maxSourceDim,
    ).toBe(0);
  });

  it('does not thrash a representation near a bucket boundary', () => {
    expect(shouldChangeRasterBucket(2048, 4096, 2200)).toBe(false);
    expect(shouldChangeRasterBucket(2048, 4096, 2600)).toBe(true);
    expect(shouldChangeRasterBucket(4096, 2048, 3000)).toBe(false);
    expect(shouldChangeRasterBucket(4096, 2048, 2500)).toBe(true);
  });

  it('uses an individual image footprint instead of scaling every image to the viewport', () => {
    const decision = selectRasterRepresentation({
      viewportWidth: 3840,
      viewportHeight: 2160,
      devicePixelRatio: 2,
      zoom: 64,
      projectedLongEdge: 180,
      cameraMoving: true,
    });

    expect(decision.requiredSourceDim).toBe(225);
    expect(decision.maxSourceDim).toBe(512);
  });

  it('caps settled high-zoom representations by the decoded-byte budget', () => {
    const decision = selectRasterRepresentation({
      viewportWidth: 3840,
      viewportHeight: 2160,
      devicePixelRatio: 2,
      zoom: 64,
      projectedLongEdge: 32_000,
      sourceWidth: 16_384,
      sourceHeight: 16_384,
      maxDecodedBytes: 256 * 1024 * 1024,
      intent: 'settled-preview',
    });

    expect(decision.maxSourceDim).toBe(8192);
    expect(decision.bucket).toBe(8192);
  });

  it('evicts large, old, non-pinned resources before expensive reusable ones', () => {
    const manager = new AdaptiveResidencyManager({
      cpuBytes: 100,
      gpuBytes: 100,
      encodedBytes: 1000,
    });
    manager.observe({
      resourceId: 'cheap-old',
      resourceType: 'image-proxy',
      cpuBytes: 60,
      recreationCost: 1,
      reuseProbability: 0,
    });
    manager.beginFrame();
    manager.observe({
      resourceId: 'expensive-new',
      resourceType: 'image-proxy',
      cpuBytes: 60,
      recreationCost: 100,
      reuseProbability: 1,
    });

    expect(manager.diagnostics().cpuBytes).toBeLessThanOrEqual(100);
    expect(manager.diagnostics().resources).toBe(1);
  });

  it('never evicts a pinned resource under pressure', () => {
    const manager = new AdaptiveResidencyManager({ cpuBytes: 1, gpuBytes: 1, encodedBytes: 1 });
    manager.observe({
      resourceId: 'active-image',
      resourceType: 'image',
      cpuBytes: 100,
      pinned: true,
      visibility: 'critical-visible',
    });
    expect(manager.diagnostics().resources).toBe(1);
    expect(manager.diagnostics().pinned).toBe(1);
  });
});
