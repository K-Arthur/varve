import { describe, expect, it, vi } from 'vitest';

/**
 * Background-removal masks are stored beside the image and composited at render
 * time, so an operation that reads the fill's pixels (upscale) sees the
 * original, unmasked photo. Without baking the mask in, the upscaled layer came
 * back with the removed background restored.
 */
const maskPixels = { value: new Uint8ClampedArray() };
const maskSize = { w: 2, h: 2 };

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
    getImageCache: () => ({ load: async () => ({ width: maskSize.w, height: maskSize.h }) }),
    fitBezierToContour: vi.fn(),
  };
});

beforeEachSetup();
function beforeEachSetup() {
  // Models a real canvas: drawImage(mask, 0, 0, w, h) scales the mask to the
  // destination, so getImageData returns a buffer of the *requested* size.
  // A stub that echoed the mask's own dimensions would let a scaling bug pass.
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const canvas = { width: 0, height: 0 } as { width: number; height: number };
      return {
        get width() {
          return canvas.width;
        },
        set width(v: number) {
          canvas.width = v;
        },
        get height() {
          return canvas.height;
        },
        set height(v: number) {
          canvas.height = v;
        },
        getContext: () => ({
          drawImage: () => {},
          getImageData: (_x: number, _y: number, w: number, h: number) => {
            const out = new Uint8ClampedArray(w * h * 4);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const sx = Math.min(maskSize.w - 1, Math.floor((x * maskSize.w) / w));
                const sy = Math.min(maskSize.h - 1, Math.floor((y * maskSize.h) / h));
                const from = (sy * maskSize.w + sx) * 4;
                const to = (y * w + x) * 4;
                out[to] = maskPixels.value[from] ?? 0;
                out[to + 1] = maskPixels.value[from + 1] ?? 0;
                out[to + 2] = maskPixels.value[from + 2] ?? 0;
                out[to + 3] = maskPixels.value[from + 3] ?? 0;
              }
            }
            return { data: out, width: w, height: h };
          },
        }),
      };
    },
  };
}

describe('bakeAlphaMaskIntoImageData', () => {
  it('multiplies mask coverage into the image alpha', async () => {
    const { bakeAlphaMaskIntoImageData } = await import('../imageOperations');
    // 2x2 opaque image
    const src = new ImageData(2, 2);
    for (let i = 0; i < 4; i++) {
      src.data[i * 4] = 200;
      src.data[i * 4 + 3] = 255;
    }
    // mask: opaque greyscale, coverage in the red channel
    const mask = new Uint8ClampedArray(4 * 4);
    const coverage = [255, 0, 128, 255];
    for (let i = 0; i < 4; i++) {
      mask[i * 4] = coverage[i]!;
      mask[i * 4 + 1] = coverage[i]!;
      mask[i * 4 + 2] = coverage[i]!;
      mask[i * 4 + 3] = 255;
    }
    maskPixels.value = mask;

    const out = await bakeAlphaMaskIntoImageData(src, 'data:image/png;base64,xx');
    expect(out.data[3]).toBe(255); // fully covered stays opaque
    expect(out.data[1 * 4 + 3]).toBe(0); // removed background becomes transparent
    expect(out.data[2 * 4 + 3]).toBe(128); // soft edge preserved
    // colour channels untouched
    expect(out.data[0]).toBe(200);
  });

  it('does not mutate the source', async () => {
    const { bakeAlphaMaskIntoImageData } = await import('../imageOperations');
    const src = new ImageData(2, 2);
    for (let i = 0; i < 4; i++) src.data[i * 4 + 3] = 255;
    const mask = new Uint8ClampedArray(4 * 4);
    for (let i = 0; i < 4; i++) mask[i * 4 + 3] = 255;
    maskPixels.value = mask;
    await bakeAlphaMaskIntoImageData(src, 'data:image/png;base64,xx');
    expect(src.data[3]).toBe(255);
  });

  it('covers the whole image when the mask resolution differs from the source', async () => {
    const { bakeAlphaMaskIntoImageData } = await import('../imageOperations');
    // A half-resolution mask, fully opaque: every source pixel must stay
    // opaque. If the mask were composited 1:1 instead of scaled, only the
    // top-left quadrant would be covered and the rest would be wrong.
    maskSize.w = 2;
    maskSize.h = 2;
    const mask = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      mask[i * 4] = 255;
      mask[i * 4 + 1] = 255;
      mask[i * 4 + 2] = 255;
      mask[i * 4 + 3] = 255;
    }
    maskPixels.value = mask;

    const src = new ImageData(4, 4);
    for (let i = 0; i < 16; i++) src.data[i * 4 + 3] = 255;

    const out = await bakeAlphaMaskIntoImageData(src, 'data:image/png;base64,xx');
    for (let i = 0; i < 16; i++) {
      expect(out.data[i * 4 + 3], `pixel ${i} alpha`).toBe(255);
    }
  });
});
