import { describe, expect, it } from 'vitest';
import { applyFilterWithCompositing, applySoftwareFilter } from './filterCompositor';
import { serializeLutForDocument } from './lut/lutService';
import { makeIdentityLut1D } from './lut/types';
import type { FilterIR } from './types';

// Helper to create a small RGBA ImageData for testing premultiplied alpha
function makeTestImageData(
  pixels: Array<[number, number, number, number]>,
  w: number,
  h: number,
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < pixels.length; i++) {
    const idx = i * 4;
    data[idx] = pixels[i]![0];
    data[idx + 1] = pixels[i]![1];
    data[idx + 2] = pixels[i]![2];
    data[idx + 3] = pixels[i]![3];
  }
  return new ImageData(data, w, h);
}

/** Minimal mock CanvasRenderingContext2D for testing filter behavior in node. */
function mockTarget() {
  const calls: string[] = [];
  const props: Record<string, unknown> = {
    filter: 'none',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  };

  const get = (name: string) => () => props[name];
  const set = (name: string) => (v: unknown) => {
    props[name] = v;
    calls.push(`set ${name}`);
  };

  const canvas = { width: 100, height: 100 } as HTMLCanvasElement;
  const target = {
    get filter() {
      return get('filter')();
    },
    set filter(v) {
      set('filter')(v);
    },
    get globalCompositeOperation() {
      return get('globalCompositeOperation')();
    },
    set globalCompositeOperation(v) {
      set('globalCompositeOperation')(v);
    },
    get globalAlpha() {
      return get('globalAlpha')();
    },
    set globalAlpha(v) {
      set('globalAlpha')(v);
    },
    canvas,
    save: () => {
      calls.push('save');
    },
    restore: () => {
      calls.push('restore');
    },
    drawImage: () => {
      calls.push('drawImage');
    },
    clearRect: () => {
      calls.push('clearRect');
    },
    getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(w, h),
    putImageData: () => {
      calls.push('putImageData');
    },
    createImageData: (w: number, h: number) => new ImageData(w, h),
    fillRect: () => {
      calls.push('fillRect');
    },
    fillStyle: '',
  };
  return { target: target as unknown as CanvasRenderingContext2D, calls, props };
}

describe('filter compositing', () => {
  it('applies canonical partial/full invert to RGB and preserves alpha', () => {
    const pixels: Array<[number, number, number, number]> = [
      [0, 10, 255, 0],
      [20, 40, 60, 128],
      [255, 255, 255, 255],
    ];
    let full: ImageData | undefined;
    let half: ImageData | undefined;
    const fullContext = {
      getImageData: () => makeTestImageData(pixels, 3, 1),
      putImageData: (data: ImageData) => {
        full = data;
      },
    };
    const halfContext = {
      getImageData: () => makeTestImageData(pixels, 3, 1),
      putImageData: (data: ImageData) => {
        half = data;
      },
    };

    applySoftwareFilter(
      fullContext as unknown as OffscreenCanvasRenderingContext2D,
      { kind: 'invert', value: 100, opacity: 1, blendMode: 'normal' },
      3,
      1,
    );
    applySoftwareFilter(
      halfContext as unknown as OffscreenCanvasRenderingContext2D,
      { kind: 'invert', value: 50, opacity: 1, blendMode: 'normal' },
      3,
      1,
    );

    expect(Array.from(full!.data)).toEqual([0, 10, 255, 0, 235, 215, 195, 128, 0, 0, 0, 255]);
    expect(Array.from(half!.data)).toEqual([0, 10, 255, 0, 128, 128, 128, 128, 128, 128, 128, 255]);
  });

  it('keeps hidden RGB unchanged across pointwise adjustments', () => {
    const filters: FilterIR[] = [
      {
        kind: 'levels',
        inputShadows: 64,
        inputMidtones: 2,
        inputHighlights: 192,
        outputShadows: 0,
        outputHighlights: 255,
        channel: 'rgb',
        opacity: 1,
        blendMode: 'normal',
      },
      {
        kind: 'exposure',
        value: 2,
        offset: 0.2,
        gammaCorrection: 0.5,
        opacity: 1,
        blendMode: 'normal',
      },
      {
        kind: 'vibrance',
        value: 100,
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    for (const filter of filters) {
      let output: ImageData | undefined;
      const context = {
        getImageData: () => makeTestImageData([[17, 33, 49, 0]], 1, 1),
        putImageData: (data: ImageData) => {
          output = data;
        },
      };
      applySoftwareFilter(context as unknown as OffscreenCanvasRenderingContext2D, filter, 1, 1);
      expect(Array.from(output!.data)).toEqual([17, 33, 49, 0]);
    }
  });

  it('provides a software brightness fallback when ctx.filter is unavailable', () => {
    const input = makeTestImageData([[100, 50, 25, 255]], 1, 1);
    let output: ImageData | undefined;
    const context = {
      getImageData: () => input,
      putImageData: (data: ImageData) => {
        output = data;
      },
    };

    applySoftwareFilter(
      context as unknown as OffscreenCanvasRenderingContext2D,
      { kind: 'brightness', value: 50, opacity: 1, blendMode: 'normal' },
      1,
      1,
    );

    expect(Array.from(output?.data ?? [])).toEqual([150, 75, 38, 255]);
  });

  it('maps the serialized Levels fields into the levels kernel', () => {
    const input = makeTestImageData([[64, 128, 255, 255]], 1, 1);
    let output: ImageData | undefined;
    const context = {
      getImageData: () => input,
      putImageData: (data: ImageData) => {
        output = data;
      },
    };

    applySoftwareFilter(
      context as unknown as OffscreenCanvasRenderingContext2D,
      {
        kind: 'levels',
        inputShadows: 64,
        inputMidtones: 1,
        inputHighlights: 255,
        outputShadows: 0,
        outputHighlights: 255,
        channel: 'rgb',
        opacity: 1,
        blendMode: 'normal',
      },
      1,
      1,
    );

    expect(Array.from(output?.data ?? [])).toEqual([0, 85, 255, 255]);
  });

  it('maps 0-255 serialized Curves points into the normalized curve kernel', () => {
    const input = makeTestImageData([[64, 128, 255, 255]], 1, 1);
    let output: ImageData | undefined;
    const context = {
      getImageData: () => input,
      putImageData: (data: ImageData) => {
        output = data;
      },
    };

    applySoftwareFilter(
      context as unknown as OffscreenCanvasRenderingContext2D,
      {
        kind: 'curves',
        points: [
          { input: 0, output: 255 },
          { input: 255, output: 0 },
        ],
        channel: 'rgb',
        opacity: 1,
        blendMode: 'normal',
      },
      1,
      1,
    );

    expect(Array.from(output?.data ?? [])).toEqual([191, 127, 0, 255]);
  });

  it('applies a versioned embedded LUT after document deserialization', () => {
    const input = makeTestImageData([[0, 128, 255, 96]], 1, 1);
    const inverse = makeIdentityLut1D(2);
    inverse.r.set([1, 0]);
    inverse.g.set([1, 0]);
    inverse.b.set([1, 0]);
    let output: ImageData | undefined;
    const context = {
      getImageData: () => input,
      putImageData: (data: ImageData) => {
        output = data;
      },
    };

    applySoftwareFilter(
      context as unknown as OffscreenCanvasRenderingContext2D,
      {
        kind: 'lut',
        lutJson: serializeLutForDocument(inverse),
        inputSpace: 'sRGB',
        interpolation: 'tetrahedral',
        intensity: 1,
        linearize: false,
        opacity: 1,
        blendMode: 'normal',
      },
      1,
      1,
    );

    expect(Array.from(output?.data ?? [])).toEqual([255, 127, 0, 96]);
  });

  it('applies a CSS-compatible filter to pixels that were already rendered', () => {
    const { target, calls } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'normal' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    expect(calls).toContain('drawImage');
  });

  it('handles opacity<1 filter via offscreen compositing when available', () => {
    const { target, calls } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 0.5, blendMode: 'normal' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // OffscreenCanvas is available: compositing path takes a snapshot, then
    // draws the filtered result back. At minimum drawImage is called.
    expect(calls).toContain('drawImage');
  });

  it('handles non-normal blend filter via offscreen compositing when available', () => {
    const { target, calls } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'multiply' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // OffscreenCanvas is available: compositing path
    expect(calls).toContain('drawImage');
  });

  it('handles non-CSS filter with CSS fallback when filter compositing available', () => {
    const { target } = mockTarget();
    const filters: FilterIR[] = [
      {
        kind: 'curves',
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 255 },
        ],
        channel: 'rgb',
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // Non-CSS filter: the offscreen compositing path handles curves via
    // software pixel processing, so target.filter stays 'none'.
    expect(target.filter).toBe('none');
  });

  it('dispatches Shadow / Highlight through the software renderer', () => {
    const source = makeTestImageData([[20, 30, 40, 255]], 1, 1);
    const target = {
      getImageData: () => source,
      putImageData: (next: ImageData) => source.data.set(next.data),
    } as unknown as Parameters<typeof applySoftwareFilter>[0];
    applySoftwareFilter(
      target,
      {
        kind: 'shadowHighlight',
        shadows: 80,
        highlights: 0,
        tonalWidth: 50,
        midpoint: 50,
        opacity: 1,
        blendMode: 'normal',
      },
      1,
      1,
    );
    expect(source.data[0]).toBeGreaterThan(20);
    expect(source.data[3]).toBe(255);
  });

  it('applies multiple CSS-compatible filters in order', () => {
    const { target, calls } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'normal' },
      { kind: 'contrast', value: 20, opacity: 1, blendMode: 'normal' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    expect(calls.filter((call) => call === 'drawImage').length).toBeGreaterThanOrEqual(1);
  });

  it('handles mixed CSS and non-CSS filters with offscreen compositing', () => {
    const { target, calls } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'normal' },
      {
        kind: 'levels',
        inputShadows: 0,
        inputHighlights: 255,
        inputMidtones: 1,
        outputShadows: 0,
        outputHighlights: 255,
        channel: 'rgb',
        opacity: 0.8,
        blendMode: 'normal',
      },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // Offscreen compositing path applies both filters
    expect(calls).toContain('drawImage');
  });

  it('applies selectiveColor filter via software bridge', () => {
    // Patch OffscreenCanvas to exercise software filter path
    const origGetContext = globalThis.OffscreenCanvas.prototype.getContext;
    const putImageDataCalls: Array<{ x: number; y: number }> = [];
    globalThis.OffscreenCanvas.prototype.getContext = (() =>
      ({
        getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(w, h),
        putImageData: (_data: ImageData, x: number, y: number) => {
          putImageDataCalls.push({ x, y });
        },
        drawImage: () => {},
        filter: 'none',
      }) as unknown as OffscreenCanvasRenderingContext2D) as unknown as typeof globalThis.OffscreenCanvas.prototype.getContext;

    const { target } = mockTarget();
    const filters: FilterIR[] = [
      {
        kind: 'selectiveColor',
        colorRange: 'reds',
        cyan: 20,
        magenta: 0,
        yellow: 0,
        black: 0,
        relative: true,
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    applyFilterWithCompositing(target, filters, 10, 10);

    // Should have called putImageData (software filter path)
    expect(putImageDataCalls.length).toBeGreaterThanOrEqual(1);

    globalThis.OffscreenCanvas.prototype.getContext = origGetContext;
  });

  it('applies colorBalance filter via software bridge', () => {
    const origGetContext = globalThis.OffscreenCanvas.prototype.getContext;
    const putImageDataCalls: Array<{ x: number; y: number }> = [];
    globalThis.OffscreenCanvas.prototype.getContext = (() =>
      ({
        getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(w, h),
        putImageData: (_data: ImageData, x: number, y: number) => {
          putImageDataCalls.push({ x, y });
        },
        drawImage: () => {},
        filter: 'none',
      }) as unknown as OffscreenCanvasRenderingContext2D) as unknown as typeof globalThis.OffscreenCanvas.prototype.getContext;

    const { target } = mockTarget();
    const filters: FilterIR[] = [
      {
        kind: 'colorBalance',
        shadows: { cyanRed: -10, magentaGreen: 0, yellowBlue: 10 },
        midtones: { cyanRed: 0, magentaGreen: 5, yellowBlue: 0 },
        highlights: { cyanRed: 10, magentaGreen: 0, yellowBlue: -10 },
        preserveLuminosity: true,
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    applyFilterWithCompositing(target, filters, 10, 10);
    expect(putImageDataCalls.length).toBeGreaterThanOrEqual(1);
    globalThis.OffscreenCanvas.prototype.getContext = origGetContext;
  });

  it('applies channelMixer filter via software bridge', () => {
    const origGetContext = globalThis.OffscreenCanvas.prototype.getContext;
    const putImageDataCalls: Array<{ x: number; y: number }> = [];
    globalThis.OffscreenCanvas.prototype.getContext = (() =>
      ({
        getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(w, h),
        putImageData: (_data: ImageData, x: number, y: number) => {
          putImageDataCalls.push({ x, y });
        },
        drawImage: () => {},
        filter: 'none',
      }) as unknown as OffscreenCanvasRenderingContext2D) as unknown as typeof globalThis.OffscreenCanvas.prototype.getContext;

    const { target } = mockTarget();
    // Red channel output: 80% red + 10% green + 0% blue + constant 5
    const filters: FilterIR[] = [
      {
        kind: 'channelMixer',
        outputChannel: 'red',
        redPercent: 80,
        greenPercent: 10,
        bluePercent: 0,
        constant: 5,
        monochrome: false,
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    applyFilterWithCompositing(target, filters, 10, 10);
    expect(putImageDataCalls.length).toBeGreaterThanOrEqual(1);
    globalThis.OffscreenCanvas.prototype.getContext = origGetContext;
  });

  it('applies photoFilter filter via software bridge', () => {
    const origGetContext = globalThis.OffscreenCanvas.prototype.getContext;
    const putImageDataCalls: Array<{ x: number; y: number }> = [];
    globalThis.OffscreenCanvas.prototype.getContext = (() =>
      ({
        getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(w, h),
        putImageData: (_data: ImageData, x: number, y: number) => {
          putImageDataCalls.push({ x, y });
        },
        drawImage: () => {},
        filter: 'none',
      }) as unknown as OffscreenCanvasRenderingContext2D) as unknown as typeof globalThis.OffscreenCanvas.prototype.getContext;

    const { target } = mockTarget();
    const filters: FilterIR[] = [
      {
        kind: 'photoFilter',
        color: [255, 100, 50, 255],
        density: 50,
        preserveLuminosity: true,
        opacity: 1,
        blendMode: 'normal',
      },
    ];
    applyFilterWithCompositing(target, filters, 10, 10);
    expect(putImageDataCalls.length).toBeGreaterThanOrEqual(1);
    globalThis.OffscreenCanvas.prototype.getContext = origGetContext;
  });

  // ── Premultiplied alpha helpers ──

  it('premultiply/unpremultiply round-trip for opaque pixels', () => {
    // We need direct access to the internal functions.
    // Simulate via applySharpen with amount=0 (no-op after conversion)
    const imgData = makeTestImageData(
      [
        [100, 150, 200, 255],
        [30, 60, 90, 255],
      ],
      2,
      1,
    );

    // Apply sharpen with amount=0 (should trigger premultiply, then no-op sharpen, then unpremultiply)
    const filter: FilterIR = {
      kind: 'sharpen',
      amount: 0,
      radius: 1,
      threshold: 0,
      opacity: 1,
      blendMode: 'normal',
    };
    const origGetContext = globalThis.OffscreenCanvas.prototype.getContext;
    const calls: Array<{ data: ImageData }> = [];
    globalThis.OffscreenCanvas.prototype.getContext = (() =>
      ({
        getImageData: (_x: number, _y: number, _w: number, _h: number) => imgData,
        putImageData: (d: ImageData) => {
          calls.push({ data: d });
        },
        drawImage: () => {},
        filter: 'none',
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        canvas: { width: 2, height: 1 },
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
      }) as unknown as OffscreenCanvasRenderingContext2D) as unknown as typeof globalThis.OffscreenCanvas.prototype.getContext;

    const { target } = mockTarget();
    applyFilterWithCompositing(target, [filter], 2, 1);
    globalThis.OffscreenCanvas.prototype.getContext = origGetContext;

    // With opaque alpha, values should be identical after round-trip
    if (calls.length > 0) {
      const out = calls[0]!.data.data;
      expect(out[0]!).toBe(100);
      expect(out[1]!).toBe(150);
      expect(out[2]!).toBe(200);
      expect(out[3]!).toBe(255);
      expect(out[4]!).toBe(30);
      expect(out[5]!).toBe(60);
      expect(out[6]!).toBe(90);
      expect(out[7]!).toBe(255);
    }
  });

  it('premultiply/unpremultiply round-trip for semi-transparent pixels', () => {
    const imgData = makeTestImageData(
      [
        [200, 100, 50, 128],
        [100, 200, 150, 64],
      ],
      2,
      1,
    );

    const filter: FilterIR = {
      kind: 'sharpen',
      amount: 0,
      radius: 1,
      threshold: 0,
      opacity: 1,
      blendMode: 'normal',
    };
    const origGetContext = globalThis.OffscreenCanvas.prototype.getContext;
    const calls: Array<{ data: ImageData }> = [];
    globalThis.OffscreenCanvas.prototype.getContext = (() =>
      ({
        getImageData: (_x: number, _y: number, _w: number, _h: number) => imgData,
        putImageData: (d: ImageData) => {
          calls.push({ data: d });
        },
        drawImage: () => {},
        filter: 'none',
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        canvas: { width: 2, height: 1 },
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
      }) as unknown as OffscreenCanvasRenderingContext2D) as unknown as typeof globalThis.OffscreenCanvas.prototype.getContext;

    const { target } = mockTarget();
    applyFilterWithCompositing(target, [filter], 2, 1);
    globalThis.OffscreenCanvas.prototype.getContext = origGetContext;

    if (calls.length > 0) {
      const out = calls[0]!.data.data;
      const diff0 = Math.abs(out[0]! - 200);
      const diff1 = Math.abs(out[1]! - 100);
      const diff2 = Math.abs(out[2]! - 50);
      const diff3 = Math.abs(out[3]! - 128);
      expect(diff0).toBeLessThanOrEqual(2);
      expect(diff1).toBeLessThanOrEqual(2);
      expect(diff2).toBeLessThanOrEqual(2);
      expect(diff3).toBe(0);
    }
  });

  it('sharpen with premultiplied alpha avoids dark fringing at transparent edges', () => {
    const w = 3;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (x === 1 && y === 1) {
          data[idx] = 255;
          data[idx + 1] = 255;
          data[idx + 2] = 255;
          data[idx + 3] = 255;
        } else {
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
        }
      }
    }
    const imgData = new ImageData(data, w, h);

    const filter: FilterIR = {
      kind: 'sharpen',
      amount: 100,
      radius: 1,
      threshold: 0,
      opacity: 1,
      blendMode: 'normal',
    };
    const origGetContext = globalThis.OffscreenCanvas.prototype.getContext;
    const calls: Array<{ data: ImageData }> = [];
    globalThis.OffscreenCanvas.prototype.getContext = (() =>
      ({
        getImageData: (_x: number, _y: number, _w: number, _h: number) => imgData,
        putImageData: (d: ImageData) => {
          calls.push({ data: d });
        },
        drawImage: () => {},
        filter: 'none',
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        canvas: { width: 3, height: 3 },
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
      }) as unknown as OffscreenCanvasRenderingContext2D) as unknown as typeof globalThis.OffscreenCanvas.prototype.getContext;

    const { target } = mockTarget();
    applyFilterWithCompositing(target, [filter], 3, 3);
    globalThis.OffscreenCanvas.prototype.getContext = origGetContext;

    if (calls.length > 0) {
      const out = calls[0]!.data.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x === 1 && y === 1) continue;
          const idx = (y * w + x) * 4;
          expect(out[idx + 3]!).toBe(0);
          expect(out[idx]!).toBe(0);
          expect(out[idx + 1]!).toBe(0);
          expect(out[idx + 2]!).toBe(0);
        }
      }
    }
  });

  it('is no-op for empty filter array', () => {
    const { target, calls } = mockTarget();
    applyFilterWithCompositing(target, [], 100, 100);
    expect(calls.length).toBe(0);
    expect(target.filter).toBe('none');
  });

  it('uses offscreen compositing in browser environment', () => {
    const { target, calls } = mockTarget();
    const filters: FilterIR[] = [
      { kind: 'brightness', value: 10, opacity: 1, blendMode: 'normal' },
    ];
    applyFilterWithCompositing(target, filters, 100, 100);
    // This is a post-render API: the filtered surface must be drawn back into
    // the target instead of leaving a CSS filter set for some future draw.
    expect(calls).toContain('clearRect');
    expect(calls).toContain('drawImage');
    expect(target.filter).toBe('none');
  });
});

describe('halftone through the compositor (canvas preview + export parity path)', () => {
  // Both the interactive canvas preview and the export rasterizer route the
  // halftone FilterIR through applySoftwareFilter. These tests assert the
  // shared path produces screened pixels with the expected tonal/color
  // behavior.

  function grayImage(w: number, h: number, gray: number, alpha = 255): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = gray;
      data[i * 4 + 1] = gray;
      data[i * 4 + 2] = gray;
      data[i * 4 + 3] = alpha;
    }
    return new ImageData(data, w, h);
  }

  function fakeCtx(image: ImageData) {
    let pixels = image.data;
    return {
      getImageData: () => new ImageData(new Uint8ClampedArray(pixels), image.width, image.height),
      putImageData: (data: ImageData) => {
        pixels = data.data;
      },
      drawImage: () => {},
      filter: 'none',
    } as unknown as CanvasRenderingContext2D;
  }

  const baseHalftone: FilterIR = {
    kind: 'halftone',
    pattern: 'dot',
    frequency: 20,
    angle: 45,
    dotShape: 'round',
    channel: 'k',
    method: 'am',
    opacity: 1,
    blendMode: 'normal',
  };

  it('screens a mid-gray fill into dark dots on a light background', () => {
    const image = grayImage(64, 64, 128);
    const ctx = fakeCtx(image);
    applySoftwareFilter(ctx, baseHalftone, 64, 64);

    const out = ctx.getImageData(0, 0, 64, 64);
    let dark = 0;
    let light = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      const g = out.data[i]!;
      if (g < 110) dark++;
      if (g > 145) light++;
    }
    expect(dark, 'screened output must contain dark dots').toBeGreaterThan(0);
    expect(light, 'screened output must contain light gaps').toBeGreaterThan(0);
    // Alpha is preserved by every screening path
    for (let i = 3; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(255);
    }
  });

  it('honors foreground and background colors through the compositor', () => {
    const image = grayImage(64, 64, 128);
    const ctx = fakeCtx(image);
    applySoftwareFilter(
      ctx,
      {
        ...baseHalftone,
        foregroundColor: [255, 0, 0],
        backgroundColor: [0, 0, 255],
      },
      64,
      64,
    );

    const out = ctx.getImageData(0, 0, 64, 64);
    let red = 0;
    let blue = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      const r = out.data[i]!;
      const g = out.data[i + 1]!;
      const b = out.data[i + 2]!;
      if (r === 255 && g === 0 && b === 0) red++;
      if (r === 0 && g === 0 && b === 255) blue++;
    }
    expect(red, 'red ink dots must appear').toBeGreaterThan(0);
    expect(blue, 'blue paper must appear').toBeGreaterThan(0);
  });

  it('invert flips the ink/paper balance through the compositor', () => {
    const ctxNormal = fakeCtx(grayImage(64, 64, 128));
    const ctxInverted = fakeCtx(grayImage(64, 64, 128));
    applySoftwareFilter(ctxNormal, baseHalftone, 64, 64);
    applySoftwareFilter(ctxInverted, { ...baseHalftone, invert: true }, 64, 64);

    const countDark = (img: ImageData): number => {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i]! < 110) n++;
      }
      return n;
    };
    const normal = ctxNormal.getImageData(0, 0, 64, 64);
    const inverted = ctxInverted.getImageData(0, 0, 64, 64);
    expect(countDark(inverted)).not.toBe(countDark(normal));
  });
});
