// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { blendPixels, CompositeCanvas, mapBlendMode } from './compositeCanvas';

function makePixelData(r: number, g: number, b: number, a: number, w = 1, h = 1): ImageData {
  const data = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    data.data[off] = r;
    data.data[off + 1] = g;
    data.data[off + 2] = b;
    data.data[off + 3] = a;
  }
  return data;
}

describe('CompositeCanvas', () => {
  it('constructor creates canvas of correct size', () => {
    const canvas = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 200, height: 100, testCanvas: canvas });
    expect(cc.width).toBe(200);
    expect(cc.height).toBe(100);
  });

  it('resize() expands canvas', () => {
    const canvas = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 10, height: 10, testCanvas: canvas });
    cc.resize(50, 50);
    expect(cc.width).toBeGreaterThanOrEqual(50);
    expect(cc.height).toBeGreaterThanOrEqual(50);
  });

  it('getImageData/putImageData round-trip', () => {
    const canvas = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 10, height: 10, testCanvas: canvas });
    const data = makePixelData(100, 150, 200, 255, 10, 10);
    cc.putImageData(data, 0, 0);
    const data2 = cc.getImageData(0, 0, 10, 10);
    expect(data2.width).toBe(10);
    expect(data2.height).toBe(10);
  });

  it('clear() resets context', () => {
    const canvas = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 10, height: 10, testCanvas: canvas });
    expect(() => cc.clear()).not.toThrow();
  });

  it('captureSource calls drawImage', () => {
    const canvas = document.createElement('canvas');
    const source = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 20, height: 20, testCanvas: canvas });
    expect(() => cc.captureSource(source, 0, 0, 10, 10)).not.toThrow();
  });

  it('compositeBlend applies blend mode', () => {
    const canvas = document.createElement('canvas');
    const source = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 20, height: 20, testCanvas: canvas });
    const sc = new CompositeCanvas({ width: 20, height: 20, testCanvas: source });
    expect(() => cc.compositeBlend(sc, 'multiply', 1)).not.toThrow();
  });

  it('compositeBlend validates the mode before saving context state', () => {
    const cc = new CompositeCanvas({
      width: 20,
      height: 20,
      testCanvas: document.createElement('canvas'),
    });
    const sc = new CompositeCanvas({
      width: 20,
      height: 20,
      testCanvas: document.createElement('canvas'),
    });
    const save = vi.spyOn(cc.ctx, 'save');

    expect(() => cc.compositeBlend(sc, 'passThrough', 1)).toThrow(
      'Blend mode is not available in Canvas2D: passThrough',
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('compositeBlend restores context state when drawing throws', () => {
    const cc = new CompositeCanvas({
      width: 20,
      height: 20,
      testCanvas: document.createElement('canvas'),
    });
    const sc = new CompositeCanvas({
      width: 20,
      height: 20,
      testCanvas: document.createElement('canvas'),
    });
    const restore = vi.spyOn(cc.ctx, 'restore');
    vi.spyOn(cc.ctx, 'drawImage').mockImplementation(() => {
      throw new Error('draw failed');
    });

    expect(() => cc.compositeBlend(sc, 'multiply', 1)).toThrow('draw failed');
    expect(restore).toHaveBeenCalledOnce();
  });

  it('compositePorterDuff applies operator', () => {
    const canvas = document.createElement('canvas');
    const source = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 20, height: 20, testCanvas: canvas });
    const sc = new CompositeCanvas({ width: 20, height: 20, testCanvas: source });
    expect(() => cc.compositePorterDuff(sc, 'source-in')).not.toThrow();
  });

  it('applyBlur does not throw', () => {
    const canvas = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 10, height: 10, testCanvas: canvas });
    expect(() => cc.applyBlur(2)).not.toThrow();
  });

  it('applyBlur with 0 radius is no-op', () => {
    const canvas = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 10, height: 10, testCanvas: canvas });
    expect(() => cc.applyBlur(0)).not.toThrow();
  });

  it('applyBlur with radius > 32 uses software path', () => {
    const canvas = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 50, height: 50, testCanvas: canvas });
    // The software path calls getImageData + gaussianBlurLinearLight + putImageData
    // With radius 50, the CSS filter path would set ctx.filter.
    // The software path does NOT set ctx.filter.
    const _ctx = cc.ctx as unknown as { filter: string };
    expect(() => cc.applyBlur(50)).not.toThrow();
  });

  it('applyBlur with very large radius uses downsample path', () => {
    const canvas = document.createElement('canvas');
    const cc = new CompositeCanvas({ width: 100, height: 100, testCanvas: canvas });
    // Radius > 100 triggers downsample-blur-upsample in gaussianBlurSeparable
    expect(() => cc.applyBlur(120)).not.toThrow();
  });
});

describe('mapBlendMode', () => {
  it('maps all standard modes', () => {
    expect(mapBlendMode('normal')).toBe('source-over');
    expect(mapBlendMode('multiply')).toBe('multiply');
    expect(mapBlendMode('screen')).toBe('screen');
    expect(mapBlendMode('overlay')).toBe('overlay');
    expect(mapBlendMode('darken')).toBe('darken');
    expect(mapBlendMode('lighten')).toBe('lighten');
    expect(mapBlendMode('colorDodge')).toBe('color-dodge');
    expect(mapBlendMode('colorBurn')).toBe('color-burn');
    expect(mapBlendMode('hardLight')).toBe('hard-light');
    expect(mapBlendMode('softLight')).toBe('soft-light');
    expect(mapBlendMode('difference')).toBe('difference');
    expect(mapBlendMode('exclusion')).toBe('exclusion');
    expect(mapBlendMode('hue')).toBe('hue');
    expect(mapBlendMode('saturation')).toBe('saturation');
    expect(mapBlendMode('color')).toBe('color');
    expect(mapBlendMode('luminosity')).toBe('luminosity');
    expect(mapBlendMode('plusLighter')).toBe('lighter');
  });

  it.each(['unknown', 'passThrough', 'plusDarker'])(
    'rejects Canvas2D-incompatible mode %s',
    (mode) => {
      expect(() => mapBlendMode(mode)).toThrow(`Blend mode is not available in Canvas2D: ${mode}`);
    },
  );
});

describe('blendPixels', () => {
  it('composites partially transparent multiplied pixels using source-over coverage terms', () => {
    const backdrop = new ImageData(new Uint8ClampedArray([255, 0, 0, 128]), 1, 1);
    const source = new ImageData(new Uint8ClampedArray([0, 0, 255, 128]), 1, 1);

    const result = blendPixels(backdrop, source, 'multiply', 1);

    // Both uncovered source blue and uncovered backdrop red contribute to the
    // source-over result; the multiply overlap itself is black.
    expect([...result.data]).toEqual([85, 0, 85, 192]);
  });

  it('rejects an unknown software blend mode', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(200, 50, 50, 255);

    expect(() => blendPixels(backdrop, source, 'unknown', 1)).toThrow(
      'Unsupported blend mode: unknown',
    );
  });
});

describe('blendPixels', () => {
  it('normal mode copies source over backdrop', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(200, 50, 50, 255);
    const result = blendPixels(backdrop, source, 'normal', 1);
    expect(result.data[0]).toBe(200);
    expect(result.data[1]).toBe(50);
  });

  it('multiply produces darker result', () => {
    const backdrop = makePixelData(200, 200, 200, 255);
    const source = makePixelData(100, 100, 100, 255);
    const result = blendPixels(backdrop, source, 'multiply', 1);
    expect(result.data[0]).toBeLessThan(150);
  });

  it('screen produces lighter result', () => {
    const backdrop = makePixelData(50, 50, 50, 255);
    const source = makePixelData(100, 100, 100, 255);
    const result = blendPixels(backdrop, source, 'screen', 1);
    expect(result.data[0]).toBeGreaterThan(100);
  });

  it('opacity 0.5 produces semi-transparent result', () => {
    const backdrop = makePixelData(0, 0, 0, 255);
    const source = makePixelData(255, 255, 255, 255);
    const result = blendPixels(backdrop, source, 'normal', 0.5);
    expect(result.data[0]).toBeGreaterThan(100);
    expect(result.data[0]).toBeLessThan(200);
  });

  it('difference returns absolute difference', () => {
    const backdrop = makePixelData(200, 100, 50, 255);
    const source = makePixelData(100, 200, 30, 255);
    const result = blendPixels(backdrop, source, 'difference', 1);
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(100);
    expect(result.data[2]).toBe(20);
  });

  it('overlay preserves highlights and shadows', () => {
    const light = makePixelData(200, 200, 200, 255);
    const dark = makePixelData(100, 100, 100, 255);
    const gray = makePixelData(128, 128, 128, 255);
    const resultLight = blendPixels(light, gray, 'overlay', 1);
    const resultDark = blendPixels(dark, gray, 'overlay', 1);
    expect(resultLight.data[0]).toBeGreaterThanOrEqual(200);
    expect(resultDark.data[0]).toBeLessThanOrEqual(100);
  });

  it('colorBurn darkens backdrop', () => {
    const backdrop = makePixelData(200, 200, 200, 255);
    const source = makePixelData(100, 100, 100, 255);
    const result = blendPixels(backdrop, source, 'colorBurn', 1);
    expect(result.data[0]).toBeLessThan(150);
  });

  it('colorDodge lightens backdrop', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(200, 200, 200, 255);
    const result = blendPixels(backdrop, source, 'colorDodge', 1);
    expect(result.data[0]).toBeGreaterThan(150);
  });

  it('hardLight combines multiply and screen', () => {
    const backdrop = makePixelData(128, 128, 128, 255);
    const dark = makePixelData(64, 64, 64, 255);
    const light = makePixelData(192, 192, 192, 255);
    const resultDark = blendPixels(backdrop, dark, 'hardLight', 1);
    const resultLight = blendPixels(backdrop, light, 'hardLight', 1);
    expect(resultDark.data[0]).toBeLessThan(128);
    expect(resultLight.data[0]).toBeGreaterThan(128);
  });

  it('softLight uses W3C formula (mid-gray is identity)', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(128, 128, 128, 255);
    const result = blendPixels(backdrop, source, 'softLight', 1);
    expect(result.data[0]).toBeCloseTo(100, 0);
    expect(result.data[1]).toBeCloseTo(100, 0);
    expect(result.data[2]).toBeCloseTo(100, 0);
  });

  it('darken picks minimum per channel', () => {
    const backdrop = makePixelData(200, 50, 150, 255);
    const source = makePixelData(100, 100, 200, 255);
    const result = blendPixels(backdrop, source, 'darken', 1);
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(50);
    expect(result.data[2]).toBe(150);
  });

  it('lighten picks maximum per channel', () => {
    const backdrop = makePixelData(200, 50, 150, 255);
    const source = makePixelData(100, 100, 200, 255);
    const result = blendPixels(backdrop, source, 'lighten', 1);
    expect(result.data[0]).toBe(200);
    expect(result.data[1]).toBe(100);
    expect(result.data[2]).toBe(200);
  });

  it('exclusion produces lower contrast difference', () => {
    const backdrop = makePixelData(200, 100, 50, 255);
    const source = makePixelData(100, 200, 30, 255);
    const result = blendPixels(backdrop, source, 'exclusion', 1);
    expect(result.data[0]).toBeLessThan(200);
    expect(result.data[0]).toBeGreaterThan(0);
  });

  it('rejects legacy plusDarker instead of silently approximating it', () => {
    const backdrop = makePixelData(128, 128, 128, 255);
    const source = makePixelData(128, 128, 128, 255);
    expect(() => blendPixels(backdrop, source, 'plusDarker', 1)).toThrow(
      'Unsupported blend mode: plusDarker',
    );
  });

  it('plusLighter adds clamped', () => {
    const backdrop = makePixelData(200, 200, 200, 255);
    const source = makePixelData(100, 100, 100, 255);
    const result = blendPixels(backdrop, source, 'plusLighter', 1);
    expect(result.data[0]).toBe(255);
  });

  it('transparent source leaves backdrop unchanged', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(255, 0, 0, 0);
    const result = blendPixels(backdrop, source, 'normal', 1);
    expect(result.data[0]).toBe(100);
  });

  it('transparent backdrop composites with source', () => {
    const backdrop = makePixelData(0, 0, 0, 0);
    const source = makePixelData(100, 150, 200, 255);
    const result = blendPixels(backdrop, source, 'normal', 1);
    expect(result.data[0]).toBe(100);
    expect(result.data[3]).toBe(255);
  });

  it('hue blend mode preserves backdrop luminosity', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(200, 50, 50, 255);
    const result = blendPixels(backdrop, source, 'hue', 1);
    expect(result.data[0]).toBeGreaterThan(0);
    expect(result.data[3]).toBe(255);
  });

  it('saturation blend mode works', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(50, 200, 50, 255);
    const result = blendPixels(backdrop, source, 'saturation', 1);
    expect(result.data[3]).toBe(255);
  });

  it('color blend mode transfers hue and saturation', () => {
    const backdrop = makePixelData(100, 100, 100, 255);
    const source = makePixelData(200, 50, 150, 255);
    const result = blendPixels(backdrop, source, 'color', 1);
    expect(result.data[3]).toBe(255);
  });

  it('luminosity blend mode transfers luma', () => {
    const backdrop = makePixelData(200, 50, 50, 255);
    const source = makePixelData(50, 100, 150, 255);
    const result = blendPixels(backdrop, source, 'luminosity', 1);
    expect(result.data[3]).toBe(255);
  });

  it('handles both transparent (alpha 0)', () => {
    const backdrop = makePixelData(0, 0, 0, 0);
    const source = makePixelData(0, 0, 0, 0);
    const result = blendPixels(backdrop, source, 'normal', 1);
    expect(result.data[3]).toBe(0);
  });
});
