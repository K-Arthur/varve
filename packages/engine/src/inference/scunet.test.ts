/**
 * Tests for SCUNet denoising inference pipeline.
 */
import { describe, expect, it } from 'vitest';
import type { ScunetInferenceInput } from './models/scunet';
import {
  postprocessScunet,
  preprocessScunet,
  SCUNET_INPUT_SIZE,
  validateScunetInput,
} from './models/scunet';

function makeImageData(width: number, height: number, fillAlpha = 255): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 128; // R
    data[i * 4 + 1] = 100; // G
    data[i * 4 + 2] = 80; // B
    data[i * 4 + 3] = fillAlpha; // A
  }
  return new ImageData(data, width, height);
}

describe('SCUNet preprocessing', () => {
  it('always resizes to 512x512 regardless of input dimensions', () => {
    const imageData = makeImageData(4, 4);
    const result = preprocessScunet(imageData);

    // Tensor is always 3 channels * 512 * 512 (model's fixed input size)
    expect(result.tensor.length).toBe(3 * SCUNET_INPUT_SIZE * SCUNET_INPUT_SIZE);
    // Original dimensions are preserved for postprocessing
    expect(result.originalWidth).toBe(4);
    expect(result.originalHeight).toBe(4);
  });

  it('resizes larger images down to 512x512', () => {
    const imageData = makeImageData(1024, 768);
    const result = preprocessScunet(imageData);

    expect(result.tensor.length).toBe(3 * SCUNET_INPUT_SIZE * SCUNET_INPUT_SIZE);
    expect(result.originalWidth).toBe(1024);
    expect(result.originalHeight).toBe(768);
  });

  it('resizes non-square images with letterbox padding', () => {
    const imageData = makeImageData(200, 100);
    const result = preprocessScunet(imageData);

    expect(result.tensor.length).toBe(3 * SCUNET_INPUT_SIZE * SCUNET_INPUT_SIZE);
    expect(result.originalWidth).toBe(200);
    expect(result.originalHeight).toBe(100);
  });

  it('produces a tensor with correct NCHW layout after resize', () => {
    const imageData = makeImageData(4, 4);
    const result = preprocessScunet(imageData);

    expect(result.hasAlpha).toBe(true);

    // Tensor layout: 3 planes of 512x512 each
    const planeSize = SCUNET_INPUT_SIZE * SCUNET_INPUT_SIZE;
    expect(result.tensor.length).toBe(3 * planeSize);

    // All values are in [0, 1] range (normalized /255)
    for (let i = 0; i < result.tensor.length; i++) {
      expect(result.tensor[i]).toBeGreaterThanOrEqual(0);
      expect(result.tensor[i]).toBeLessThanOrEqual(1);
    }
  });

  it('extracts alpha channel separately from original dimensions', () => {
    const imageData = makeImageData(2, 2, 128);
    const result = preprocessScunet(imageData);

    expect(result.hasAlpha).toBe(true);
    expect(result.alphaData).not.toBeNull();
    // Alpha is extracted from the ORIGINAL image (2x2 = 4 pixels)
    expect(result.alphaData!.length).toBe(4);
    expect(result.alphaData![0]).toBe(128);
  });

  it('produces correct tensor layout (R plane, G plane, B plane) at 512x512', () => {
    // Use distinct values per channel to verify layout
    const data = new Uint8ClampedArray([
      200,
      100,
      50,
      255, // pixel 0: R=200, G=100, B=50
      10,
      20,
      30,
      255, // pixel 1: R=10, G=20, B=30
    ]);
    const imageData = new ImageData(data, 2, 1);
    const result = preprocessScunet(imageData);

    const planeSize = SCUNET_INPUT_SIZE * SCUNET_INPUT_SIZE;
    // Tensor has 3 planes of 512x512 each
    expect(result.tensor.length).toBe(3 * planeSize);
    // R plane starts at offset 0
    expect(result.tensor[0]).toBeDefined();
    // G plane starts at offset planeSize
    expect(result.tensor[planeSize]).toBeDefined();
    // B plane starts at offset 2*planeSize
    expect(result.tensor[2 * planeSize]).toBeDefined();
  });
});

describe('SCUNet postprocessing', () => {
  it('resizes output to original dimensions with bilinear interpolation', () => {
    // Simulate 2×2 model output → 4×4 target
    const output = new Float32Array(3 * 2 * 2); // 3 channels, 2×2
    // Fill with distinct values: R=0.8, G=0.5, B=0.2
    for (let i = 0; i < 4; i++) {
      output[i] = 0.8; // R
      output[4 + i] = 0.5; // G
      output[8 + i] = 0.2; // B
    }

    const alphaData = new Uint8ClampedArray([255, 255, 255, 255]);
    const originalData = new Uint8ClampedArray([
      100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255,
    ]);

    const result = postprocessScunet(output, 2, 2, 4, 4, alphaData, 1, originalData);

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    // With strength=1, output should be fully denoised
    // R=0.8*255=204, G=0.5*255=127.5, B=0.2*255=51
    expect(result.data[0]).toBe(204); // R
    expect(result.data[1]).toBe(128); // G (rounded)
    expect(result.data[2]).toBe(51); // B
    expect(result.data[3]).toBe(255); // Alpha preserved
  });

  it('blends with original based on strength', () => {
    const output = new Float32Array(3 * 1 * 1); // Single pixel
    output[0] = 1.0; // R = 255
    output[1] = 1.0; // G = 255
    output[2] = 1.0; // B = 255

    const alphaData = new Uint8ClampedArray([200]);
    const originalData = new Uint8ClampedArray([50, 100, 150, 200]);

    // strength=0.5: halfway between denoised (255,255,255) and original (50,100,150)
    const result = postprocessScunet(output, 1, 1, 1, 1, alphaData, 0.5, originalData);

    expect(result.data[0]).toBe(Math.round(255 * 0.5 + 50 * 0.5)); // 152 or 153
    expect(result.data[1]).toBe(Math.round(255 * 0.5 + 100 * 0.5)); // 177 or 178
    expect(result.data[2]).toBe(Math.round(255 * 0.5 + 150 * 0.5)); // 202 or 203
    expect(result.data[3]).toBe(200); // Alpha preserved
  });

  it('preserves alpha when no alpha data provided', () => {
    const output = new Float32Array(3 * 1 * 1);
    output[0] = 0.5;
    output[1] = 0.5;
    output[2] = 0.5;

    const originalData = new Uint8ClampedArray([100, 100, 100, 180]);

    const result = postprocessScunet(output, 1, 1, 1, 1, null, 1, originalData);

    // Alpha falls back to original
    expect(result.data[3]).toBe(180);
  });
});

describe('SCUNet input validation', () => {
  it('accepts valid input', () => {
    const input: ScunetInferenceInput = {
      imageData: makeImageData(100, 100),
    };
    expect(validateScunetInput(input)).toBeNull();
  });

  it('rejects missing image data', () => {
    const input = { imageData: null as unknown as ImageData };
    expect(validateScunetInput(input)).toBe('Image data is required');
  });

  it('rejects zero-dimension image', () => {
    const input: ScunetInferenceInput = {
      imageData: new ImageData(new Uint8ClampedArray(0), 0, 0),
    };
    expect(validateScunetInput(input)).toBe('Image has zero dimensions');
  });

  it('rejects strength out of range', () => {
    const input: ScunetInferenceInput = {
      imageData: makeImageData(10, 10),
      strength: 1.5,
    };
    expect(validateScunetInput(input)).toBe('Strength must be between 0 and 1');
  });

  it('accepts images of any size (resizing is automatic)', () => {
    const input: ScunetInferenceInput = {
      imageData: makeImageData(2000, 2000),
    };
    expect(validateScunetInput(input)).toBeNull();
  });

  it('accepts very small images', () => {
    const input: ScunetInferenceInput = {
      imageData: makeImageData(1, 1),
    };
    expect(validateScunetInput(input)).toBeNull();
  });

  it('accepts strength at boundaries', () => {
    const img = makeImageData(10, 10);
    expect(validateScunetInput({ imageData: img, strength: 0 })).toBeNull();
    expect(validateScunetInput({ imageData: img, strength: 1 })).toBeNull();
  });
});

describe('SCUNet constants', () => {
  it('input size is 512', () => {
    expect(SCUNET_INPUT_SIZE).toBe(512);
  });
});
