import { describe, expect, it } from 'vitest';
import {
  prepareDiffusionFrame,
  SD15_INPAINTING_FRAME_SIZE,
  SDXL_INPAINTING_FRAME_CONTRACT,
} from './diffusionFrame';

function image(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = x * 20;
      data[offset + 1] = y * 20;
      data[offset + 2] = 80;
      data[offset + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

describe('prepareDiffusionFrame', () => {
  it('letterboxes a non-square context without stretching its aspect ratio', () => {
    const source = image(4, 2);
    const mask = new Uint8Array(source.width * source.height);
    mask[1] = 255;
    const frame = prepareDiffusionFrame(source, mask, source.width, source.height);

    expect(frame.width).toBe(SD15_INPAINTING_FRAME_SIZE);
    expect(frame.height).toBe(SD15_INPAINTING_FRAME_SIZE);
    expect(frame.contentWidth).toBe(512);
    expect(frame.contentHeight).toBe(256);
    expect(frame.contentX).toBe(0);
    expect(frame.contentY).toBe(128);
    expect(frame.mask[frame.contentY * 512 + 128]).toBeGreaterThan(0);
    expect(frame.mask[frame.contentY * 512 + 128]).toBeLessThan(255);
    expect(frame.mask[0]).toBe(0);
    expect(frame.imageData.data[0]).toBe(127);
    expect(frame.imageData.data[(128 * 512 + 1) * 4]).not.toBe(127);
  });

  it('maps a model result back to exact source dimensions and protects padding', () => {
    const source = image(4, 2);
    const mask = new Uint8Array(source.width * source.height).fill(255);
    const frame = prepareDiffusionFrame(source, mask, source.width, source.height);
    const generated = new ImageData(
      new Uint8ClampedArray(frame.width * frame.height * 4),
      frame.width,
      frame.height,
    );
    for (let offset = 0; offset < generated.data.length; offset += 4) {
      generated.data[offset] = 240;
      generated.data[offset + 1] = 240;
      generated.data[offset + 2] = 240;
      generated.data[offset + 3] = 255;
    }

    const restored = frame.restore(generated);
    expect(restored.width).toBe(source.width);
    expect(restored.height).toBe(source.height);
    expect(restored.data[0]).toBe(240);
    expect(restored.data[restored.data.length - 4]).toBe(240);
  });

  it('keeps a native-sized square frame byte-for-byte when restoring', () => {
    const source = image(512, 512);
    const mask = new Uint8Array(source.width * source.height).fill(128);
    const frame = prepareDiffusionFrame(source, mask, source.width, source.height);
    expect(frame.contentX).toBe(0);
    expect(frame.contentY).toBe(0);
    expect(frame.imageData.data).toEqual(source.data);
    expect(frame.mask).toEqual(mask);

    const output = image(512, 512);
    expect(frame.restore(output).data).toEqual(output.data);
  });

  it('uses the selected model contract for a non-square frame', () => {
    const source = image(4, 2);
    const mask = new Uint8Array(source.width * source.height);
    mask[1] = 255;
    const contract = {
      id: 'test-768x512-inpainting-v1',
      preprocessingVersion: 'test-letterbox-v1',
      inputKind: 'masked-inpainting',
      maskConvention: 'white-edit-black-preserve',
      frameWidth: 768,
      frameHeight: 512,
      dimensionMultiple: 64,
    } as const;
    const frame = prepareDiffusionFrame(source, mask, source.width, source.height, contract);

    expect(frame.contractId).toBe(contract.id);
    expect(frame.preprocessingVersion).toBe(contract.preprocessingVersion);
    expect(frame.width).toBe(768);
    expect(frame.height).toBe(512);
    expect(frame.contentWidth).toBe(768);
    expect(frame.contentHeight).toBe(384);
    expect(frame.contentX).toBe(0);
    expect(frame.contentY).toBe(64);
    expect(frame.mask[frame.contentY * frame.width + 192]).toBeGreaterThan(0);
    expect(frame.mask[0]).toBe(0);
    expect(frame.imageData.data[0]).toBe(127);

    const generated = image(frame.width, frame.height);
    expect(frame.restore(generated).width).toBe(source.width);
    expect(frame.restore(generated).height).toBe(source.height);
  });

  it('supports the larger SDXL contract without changing the source ratio', () => {
    const source = image(4, 2);
    const mask = new Uint8Array(source.width * source.height).fill(255);
    const frame = prepareDiffusionFrame(
      source,
      mask,
      source.width,
      source.height,
      SDXL_INPAINTING_FRAME_CONTRACT,
    );

    expect(frame.width).toBe(1024);
    expect(frame.height).toBe(1024);
    expect(frame.contentWidth / frame.contentHeight).toBeCloseTo(source.width / source.height, 10);
    expect(frame.contentY).toBe(256);
    expect(frame.mask.slice(0, frame.width)).toEqual(new Uint8Array(frame.width));
  });

  it('converts canonical coverage for providers with the opposite mask polarity', () => {
    const source = image(4, 2);
    const mask = new Uint8Array(source.width * source.height);
    mask[0] = 255;
    const frame = prepareDiffusionFrame(source, mask, source.width, source.height, {
      id: 'test-inverse-mask-v1',
      preprocessingVersion: 'test-letterbox-v1',
      inputKind: 'masked-inpainting',
      maskConvention: 'white-preserve-black-edit',
      frameWidth: 4,
      frameHeight: 4,
      dimensionMultiple: 2,
    });

    // The top and bottom rows are letterbox padding and must be preserved.
    expect(frame.mask[0]).toBe(255);
    // The first source pixel is editable in Varve's canonical representation.
    expect(frame.mask[frame.contentY * frame.width]).toBe(0);
    // A canonical preserve value becomes white for this provider.
    expect(frame.mask[frame.contentY * frame.width + 1]).toBe(255);
    expect(frame.maskConvention).toBe('white-preserve-black-edit');
  });

  it('does not send a reference-only editor through the masked frame path', () => {
    expect(() =>
      prepareDiffusionFrame(image(2, 2), new Uint8Array(4), 2, 2, {
        id: 'reference-editor-v1',
        preprocessingVersion: 'test-letterbox-v1',
        inputKind: 'reference-edit',
        maskConvention: 'white-edit-black-preserve',
        frameWidth: 2,
        frameHeight: 2,
        dimensionMultiple: 2,
      }),
    ).toThrow('masked-inpainting provider');
  });

  it('rejects a model frame that violates its declared dimension multiple', () => {
    expect(() =>
      prepareDiffusionFrame(image(4, 2), new Uint8Array(8), 4, 2, {
        id: 'invalid-contract',
        preprocessingVersion: 'test-letterbox-v1',
        inputKind: 'masked-inpainting',
        maskConvention: 'white-edit-black-preserve',
        frameWidth: 510,
        frameHeight: 512,
        dimensionMultiple: 64,
      }),
    ).toThrow('dimension multiple');
  });

  it('rejects a mask whose dimensions do not describe the source context', () => {
    expect(() => prepareDiffusionFrame(image(4, 2), new Uint8Array(4), 2, 2)).toThrow(
      'source-context dimensions',
    );
  });
});
