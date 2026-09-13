import { describe, expect, it } from 'vitest';
import {
  buildExpandedFrame,
  computeExpandPlan,
  estimateExpandGenerationResolution,
  expandCoverageMask,
  expandPlanOutputFrame,
  normalizeExpandMargins,
  restoreProtectedPixels,
} from './expandPlan';

function patternedImage(width: number, height: number): ImageData {
  const image = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      image.data[offset] = (x * 7 + y * 13) % 256;
      image.data[offset + 1] = (x * 3 + y * 29) % 256;
      image.data[offset + 2] = (x * 17 + y * 5) % 256;
      image.data[offset + 3] = (x + y) % 2 === 0 ? 255 : 128;
    }
  }
  return image;
}

function expectPlan(result: ReturnType<typeof computeExpandPlan>) {
  if (!result.ok) throw new Error(`Expected a plan, received ${result.error.code}`);
  return result.plan;
}

describe('computeExpandPlan', () => {
  it('translates the source by the left/top margins without resampling', () => {
    const plan = expectPlan(computeExpandPlan(40, 30, { top: 10, right: 20, bottom: 5, left: 7 }));
    expect(plan).toMatchObject({
      outputWidth: 67,
      outputHeight: 45,
      sourceOffsetX: 7,
      sourceOffsetY: 10,
      protectedRegion: { x: 7, y: 10, width: 40, height: 30 },
      isNoop: false,
    });
    expect(plan.expandPixels).toBe(67 * 45 - 40 * 30);
  });

  it('makes zero expansion an explicit no-op', () => {
    const plan = expectPlan(computeExpandPlan(20, 10, { top: 0, right: 0, bottom: 0, left: 0 }));
    expect(plan.isNoop).toBe(true);
    expect(plan.expandPixels).toBe(0);
    expect(plan.expandRatio).toBe(0);
    expect(plan.outputWidth).toBe(20);
    expect(plan.outputHeight).toBe(10);
  });

  it('rejects invalid sources, margins, and unsafe sizes with typed reasons', () => {
    expect(computeExpandPlan(0, 10, { top: 0, right: 0, bottom: 0, left: 0 })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-source' }),
    });
    expect(computeExpandPlan(10, 10, { top: -1, right: 0, bottom: 0, left: 0 })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-margin' }),
    });
    expect(computeExpandPlan(10, 10, { top: 0.5, right: 0, bottom: 0, left: 0 })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-margin' }),
    });
    expect(
      computeExpandPlan(10, 10, { top: 0, right: 0, bottom: 0, left: 5 }, { maxMargin: 4 }),
    ).toEqual({ ok: false, error: expect.objectContaining({ code: 'too-large' }) });
    expect(
      computeExpandPlan(
        10,
        10,
        { top: 0, right: 0, bottom: 0, left: 5 },
        {
          maxOutputWidth: 14,
        },
      ),
    ).toEqual({ ok: false, error: expect.objectContaining({ code: 'too-large' }) });
    expect(
      computeExpandPlan(
        10,
        10,
        { top: 0, right: 0, bottom: 0, left: 5 },
        {
          maxOutputPixels: 60,
        },
      ),
    ).toEqual({ ok: false, error: expect.objectContaining({ code: 'too-large' }) });
  });

  it('validates each margin side independently', () => {
    expect(normalizeExpandMargins({ top: 0, right: 1, bottom: 2, left: 3 })).toBeNull();
    expect(normalizeExpandMargins({ top: 0, right: Number.NaN, bottom: 0, left: 0 })?.code).toBe(
      'invalid-margin',
    );
  });
});

describe('expandCoverageMask and buildExpandedFrame', () => {
  it('marks the whole new border including corners and preserves the source exactly', () => {
    const source = patternedImage(9, 6);
    const plan = expectPlan(computeExpandPlan(9, 6, { top: 2, right: 3, bottom: 4, left: 5 }));
    const frame = buildExpandedFrame(source, plan);
    expect(frame.width).toBe(plan.outputWidth);
    expect(frame.height).toBe(plan.outputHeight);
    expect(frame.mask.length).toBe(plan.outputWidth * plan.outputHeight);

    for (let y = 0; y < plan.outputHeight; y += 1) {
      for (let x = 0; x < plan.outputWidth; x += 1) {
        const protectedPixel =
          x >= plan.sourceOffsetX &&
          x < plan.sourceOffsetX + plan.sourceWidth &&
          y >= plan.sourceOffsetY &&
          y < plan.sourceOffsetY + plan.sourceHeight;
        expect(frame.mask[y * plan.outputWidth + x]).toBe(protectedPixel ? 0 : 255);
      }
    }

    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const origin = (y * source.width + x) * 4;
        const translated =
          ((y + plan.sourceOffsetY) * plan.outputWidth + (x + plan.sourceOffsetX)) * 4;
        expect(frame.imageData.data[translated]).toBe(source.data[origin]);
        expect(frame.imageData.data[translated + 1]).toBe(source.data[origin + 1]);
        expect(frame.imageData.data[translated + 2]).toBe(source.data[origin + 2]);
        expect(frame.imageData.data[translated + 3]).toBe(source.data[origin + 3]);
      }
    }
  });

  it('uses edge-clamped pixels only as masked context outside the source', () => {
    const source = patternedImage(4, 4);
    const plan = expectPlan(computeExpandPlan(4, 4, { top: 1, right: 1, bottom: 1, left: 1 }));
    const frame = buildExpandedFrame(source, plan);
    const corner = (0 * plan.outputWidth + 0) * 4;
    const topLeft = 0;
    expect(frame.imageData.data[corner]).toBe(source.data[topLeft]);
    expect(frame.mask[0]).toBe(255);
  });

  it('produces an all-zero mask for a no-op plan', () => {
    const plan = expectPlan(computeExpandPlan(5, 5, { top: 0, right: 0, bottom: 0, left: 0 }));
    const mask = expandCoverageMask(plan);
    expect(mask.every((value) => value === 0)).toBe(true);
  });

  it('rejects a frame whose source does not match the plan', () => {
    const plan = expectPlan(computeExpandPlan(5, 5, { top: 0, right: 1, bottom: 0, left: 0 }));
    expect(() => buildExpandedFrame(patternedImage(4, 5), plan)).toThrow();
  });
});

describe('restoreProtectedPixels', () => {
  it('repairs provider corruption inside the protected rectangle only', () => {
    const source = patternedImage(6, 5);
    const plan = expectPlan(computeExpandPlan(6, 5, { top: 2, right: 2, bottom: 2, left: 2 }));
    const frame = buildExpandedFrame(source, plan);
    for (let i = 0; i < frame.imageData.data.length; i += 1) frame.imageData.data[i] = 0;
    const repaired = restoreProtectedPixels(frame.imageData, source, plan);
    expect(repaired).toBe(6 * 5);
    for (let y = 0; y < plan.outputHeight; y += 1) {
      for (let x = 0; x < plan.outputWidth; x += 1) {
        const offset = (y * plan.outputWidth + x) * 4;
        const protectedPixel =
          x >= plan.sourceOffsetX &&
          x < plan.sourceOffsetX + plan.sourceWidth &&
          y >= plan.sourceOffsetY &&
          y < plan.sourceOffsetY + plan.sourceHeight;
        if (protectedPixel) continue;
        expect(frame.imageData.data[offset]).toBe(0);
      }
    }
  });

  it('is idempotent and returns zero repairs when the source is intact', () => {
    const source = patternedImage(5, 4);
    const plan = expectPlan(computeExpandPlan(5, 4, { top: 1, right: 1, bottom: 1, left: 1 }));
    const frame = buildExpandedFrame(source, plan);
    expect(restoreProtectedPixels(frame.imageData, source, plan)).toBe(0);
    expect(restoreProtectedPixels(frame.imageData, source, plan)).toBe(0);
  });

  it('rejects mismatched frames instead of guessing an alignment', () => {
    const source = patternedImage(5, 4);
    const plan = expectPlan(computeExpandPlan(5, 4, { top: 1, right: 0, bottom: 0, left: 0 }));
    const wrong = new ImageData(6, 5);
    expect(() => restoreProtectedPixels(wrong, source, plan)).toThrow();
  });
});

describe('estimateExpandGenerationResolution', () => {
  it('discloses enlargement when the model frame is smaller than the output', () => {
    const plan = expectPlan(
      computeExpandPlan(1024, 768, { top: 100, right: 100, bottom: 100, left: 100 }),
    );
    const estimate = estimateExpandGenerationResolution(plan, 512);
    expect(estimate.generatedLongSide).toBe(512);
    expect(estimate.generatedScale).toBeCloseTo(512 / 1224);
    expect(estimate.disclosure).toContain('512');
    expect(estimate.disclosure).toContain('enlarged');
  });

  it('reports native resolution for small frames', () => {
    const plan = expectPlan(
      computeExpandPlan(200, 200, { top: 10, right: 10, bottom: 10, left: 10 }),
    );
    const estimate = estimateExpandGenerationResolution(plan, 512);
    expect(estimate.generatedScale).toBe(1);
    expect(estimate.disclosure).toContain('requested output resolution');
  });
});

describe('expandPlanOutputFrame', () => {
  it('records the persisted source-pixel frame without ambiguity', () => {
    const plan = expectPlan(computeExpandPlan(30, 20, { top: 4, right: 6, bottom: 8, left: 10 }));
    expect(expandPlanOutputFrame(plan)).toEqual({
      x: -10,
      y: -4,
      width: 46,
      height: 32,
      sourceWidth: 30,
      sourceHeight: 20,
    });
  });
});
