import { describe, expect, it } from 'vitest';
import { getSegmentationModelSpec, packModelInput } from '../modelSpec';

describe('segmentation model specifications', () => {
  it('matches the official IS-Net general-use preprocessing contract', () => {
    const spec = getSegmentationModelSpec('isnet-general-use');
    expect(spec.inputSize).toBe(1024);
    expect(spec.mean).toEqual([0.5, 0.5, 0.5]);
    expect(spec.std).toEqual([1, 1, 1]);
    expect(spec.applySigmoid).toBe(false);
  });

  it('normalizes pixels by 255 rather than an image-dependent maximum', () => {
    const spec = getSegmentationModelSpec('isnet-general-use');
    const packed = packModelInput(
      { data: new Uint8Array([128, 64, 0, 255]), width: 1, height: 1 },
      spec,
    );
    expect(packed[0]).toBeCloseTo(128 / 255 - 0.5);
    expect(packed[1]).toBeCloseTo(64 / 255 - 0.5);
    expect(packed[2]).toBeCloseTo(-0.5);
  });

  it('keeps U2-Net Light as the compact 320px fallback', () => {
    const spec = getSegmentationModelSpec('u2netp');
    expect(spec.inputSize).toBe(320);
    expect(spec.applySigmoid).toBe(false);
  });
});
