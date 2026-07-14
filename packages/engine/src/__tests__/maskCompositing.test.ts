// @vitest-environment jsdom
/**
 * Tests for enhanced mask compositing: luminance, inversion, feather, density.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyMaskPostProcess,
  pixelToMaskAlpha,
  renderEnhancedMask,
  srgbToLuminance,
} from '../maskCompositing';

describe('srgbToLuminance', () => {
  it('returns 0 for black', () => {
    expect(srgbToLuminance(0, 0, 0)).toBeCloseTo(0, 3);
  });

  it('returns ~1 for white', () => {
    expect(srgbToLuminance(255, 255, 255)).toBeCloseTo(1, 3);
  });

  it('returns correct perceptually-uniform luminance for mid-gray', () => {
    // Mid-gray (128,128,128) in sRGB is ~21.6% luminance in linear space,
    // not 50.2% as the naive gamma-encoded formula would suggest.
    const l = srgbToLuminance(128, 128, 128);
    expect(l).toBeCloseTo(0.216, 3);
  });

  it('uses correct coefficients for red', () => {
    // R coefficient is 0.2126
    const l = srgbToLuminance(255, 0, 0);
    expect(l).toBeCloseTo(0.2126, 4);
  });

  it('uses correct coefficients for green', () => {
    // G coefficient is 0.7152
    const l = srgbToLuminance(0, 255, 0);
    expect(l).toBeCloseTo(0.7152, 4);
  });

  it('uses correct coefficients for blue', () => {
    // B coefficient is 0.0722
    const l = srgbToLuminance(0, 0, 255);
    expect(l).toBeCloseTo(0.0722, 4);
  });

  it('handles out-of-range values', () => {
    // Should not throw
    expect(() => srgbToLuminance(-1, 300, 0)).not.toThrow();
  });
});

describe('pixelToMaskAlpha', () => {
  it('returns alpha for alpha mode', () => {
    expect(pixelToMaskAlpha(255, 0, 0, 128, false)).toBeCloseTo(0.502, 2);
  });

  it('returns luminance * alpha for luminance mode', () => {
    // White (luminance=1) at 50% alpha
    expect(pixelToMaskAlpha(255, 255, 255, 128, true)).toBeCloseTo(0.502, 2);
  });

  it('returns 0 for black in luminance mode', () => {
    expect(pixelToMaskAlpha(0, 0, 0, 255, true)).toBeCloseTo(0, 3);
  });

  it('returns 1 for white in luminance mode', () => {
    expect(pixelToMaskAlpha(255, 255, 255, 255, true)).toBeCloseTo(1, 3);
  });
});

describe('applyMaskPostProcess', () => {
  function createTestData(width: number, height: number, fillAlpha: number): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255; // R
      data[i + 1] = 128; // G
      data[i + 2] = 64; // B
      data[i + 3] = fillAlpha; // A
    }
    return new ImageData(data, width, height);
  }

  it('does nothing without options', () => {
    const img = createTestData(10, 10, 128);
    applyMaskPostProcess(img, {});
    // Alpha should be unchanged
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(128);
    }
  });

  it('inverts pixels when inverted', () => {
    const img = createTestData(10, 10, 200);
    applyMaskPostProcess(img, { inverted: true });
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(55); // 255 - 200 = 55
    }
  });

  it('scales alpha by density', () => {
    const img = createTestData(10, 10, 200);
    applyMaskPostProcess(img, { density: 0.5 });
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(100); // 200 * 0.5 = 100
    }
  });

  it('applies luminance conversion before other ops', () => {
    // Create data with a saturated color - after luminance conversion,
    // the RGB channels all become the luminance value
    const data = new Uint8ClampedArray(4);
    data[0] = 255; // R
    data[1] = 0; // G
    data[2] = 0; // B
    data[3] = 255; // A
    const img = new ImageData(data, 1, 1);

    applyMaskPostProcess(img, { luminance: true });

    // After luminance: value should be 0.2126 * 255 ≈ 54 for all channels
    expect(img.data[0]).toBeCloseTo(54, -1);
    expect(img.data[3]).toBeCloseTo(54, -1); // alpha also becomes luminance
  });

  it('applies inversion after feather (order matters)', () => {
    // Full white pixels with 255 alpha
    const data = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    // Set one pixel to transparent to create edge
    data[3] = 0; // pixel 0 alpha = 0

    const img = new ImageData(data, 4, 1);
    applyMaskPostProcess(img, { inverted: true, feather: 1 });

    // After inversion+feather, the formerly transparent pixel should be
    // partially affected by its neighbors
    expect(img.data[3]).toBeGreaterThan(0); // was 0, now blurred + inverted
  });

  it('order: feather → invert → density', () => {
    // Test with explicit known values:
    // All white, alpha=200, except one pixel with alpha=0
    const data = new Uint8ClampedArray(12 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 200;
    }
    // Pixel 4 (index 16-19): alpha = 0
    data[16 + 3] = 0;

    const img = new ImageData(data, 6, 2);
    applyMaskPostProcess(img, {
      inverted: true,
      feather: 3,
      density: 0.8,
    });

    // After feather: pixel 4's alpha blends with neighbors (gets higher)
    // After invert: 255 - value
    // After density: value * 0.8
    // So pixel 4 alpha should be:
    //  (255 - blurred) * 0.8
    // Where blurred > 0 (neighbors bleed in)
    // So pixel 4 alpha should be < 200 * 0.8 = 160 but > 0
    const pixel4Alpha = img.data[16 + 3];
    expect(pixel4Alpha).toBeGreaterThan(0);
    expect(pixel4Alpha).toBeLessThan(160);
  });
});

describe('renderEnhancedMask', () => {
  let mainCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no context');
    mainCtx = ctx;
  });

  it('renders alpha mask with default options (backward compat)', () => {
    const maskDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {});
    const contentDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {});

    renderEnhancedMask(mainCtx, { draw: maskDraw }, { draw: contentDraw });

    expect(maskDraw).toHaveBeenCalledTimes(1);
    expect(contentDraw).toHaveBeenCalledTimes(1);
    expect(mainCtx.drawImage).toHaveBeenCalled();
  });

  it('applies inversion to mask', () => {
    // Draw opaque white mask → content drawn
    // With inversion → content hidden where mask is opaque
    const maskDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fillRect(0, 0, 200, 200);
    });
    const contentDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 200, 200);
    });

    renderEnhancedMask(mainCtx, { draw: maskDraw }, { draw: contentDraw }, { inverted: true });

    expect(maskDraw).toHaveBeenCalled();
    expect(contentDraw).toHaveBeenCalled();
    expect(mainCtx.drawImage).toHaveBeenCalled();
  });

  it('applies density to mask', () => {
    const maskDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fillRect(0, 0, 200, 200);
    });
    const contentDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 200, 200);
    });

    // density=0 means mask has no effect
    renderEnhancedMask(mainCtx, { draw: maskDraw }, { draw: contentDraw }, { density: 0 });

    expect(maskDraw).toHaveBeenCalled();
    expect(contentDraw).toHaveBeenCalled();
  });

  it('handles luminance mask', () => {
    const maskDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'rgb(255,0,0)'; // Red: luminance = 0.2126
      ctx.fillRect(0, 0, 200, 200);
    });
    const contentDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'blue';
      ctx.fillRect(0, 0, 200, 200);
    });

    renderEnhancedMask(mainCtx, { draw: maskDraw }, { draw: contentDraw }, { luminance: true });

    expect(maskDraw).toHaveBeenCalled();
    expect(contentDraw).toHaveBeenCalled();
    expect(mainCtx.drawImage).toHaveBeenCalled();
  });

  it('handles unlinked mask transform', () => {
    const maskDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 200, 200);
    });
    const contentDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {});

    renderEnhancedMask(
      mainCtx,
      { draw: maskDraw },
      { draw: contentDraw },
      { unlinked: true, maskTransform: [2, 0, 0, 2, 50, 50] },
    );

    expect(maskDraw).toHaveBeenCalled();
    expect(contentDraw).toHaveBeenCalled();
  });

  it('does not throw for zero-size canvas', () => {
    const zeroCanvas = document.createElement('canvas');
    zeroCanvas.width = 0;
    zeroCanvas.height = 0;
    const zeroCtx = zeroCanvas.getContext('2d');
    if (!zeroCtx) throw new Error('no context');

    expect(() => {
      renderEnhancedMask(zeroCtx, { draw: vi.fn() }, { draw: vi.fn() });
    }).not.toThrow();
  });

  it('applies feather (smoke test)', () => {
    const maskDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 200, 200);
    });
    const contentDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 200, 200);
    });

    expect(() => {
      renderEnhancedMask(mainCtx, { draw: maskDraw }, { draw: contentDraw }, { feather: 5 });
    }).not.toThrow();
  });

  it('preserves main context state', () => {
    mainCtx.globalCompositeOperation = 'source-over';

    renderEnhancedMask(
      mainCtx,
      { draw: vi.fn() },
      { draw: vi.fn() },
      { inverted: true, density: 0.5 },
    );

    expect(mainCtx.globalCompositeOperation).toBe('source-over');
  });

  it('applies feather + invert + density combo', () => {
    const maskDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 200, 200);
    });
    const contentDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {});

    expect(() => {
      renderEnhancedMask(
        mainCtx,
        { draw: maskDraw },
        { draw: contentDraw },
        { inverted: true, feather: 10, density: 0.7 },
      );
    }).not.toThrow();
  });
});
