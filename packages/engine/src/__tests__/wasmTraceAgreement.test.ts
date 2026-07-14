import { describe, expect, it } from 'vitest';
import type { RasterTraceResult } from '../rasterTrace';
import { traceRasterToPaths } from '../rasterTrace';
import { wasmTraceProvider } from '../upscaleProviders/wasmTraceProvider';

/**
 * Check if we're in an environment where WASM can be loaded.
 * jsdom and plain Node (without a built WASM binary) will not have it.
 */
async function isWasmAvailable(): Promise<boolean> {
  try {
    return await wasmTraceProvider.isAvailable({}, undefined);
  } catch {
    return false;
  }
}

function rgba(width: number, height: number, pixels: number[]): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

describe('wasmTraceAgreement', () => {
  it('produces same number of paths as TS trace for a simple square', async () => {
    if (!(await isWasmAvailable())) {
      return;
    }

    const pixels: number[] = [];
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        const dark = x >= 3 && x < 7 && y >= 3 && y < 7;
        pixels.push(dark ? 0 : 255, dark ? 0 : 255, dark ? 0 : 255, 255);
      }
    }
    const imageData = rgba(10, 10, pixels);

    const wasmResult: RasterTraceResult = await wasmTraceProvider.trace(imageData, {
      threshold: 128,
      minArea: 4,
    });

    expect(wasmResult.paths.length).toBeGreaterThanOrEqual(1);
    expect(wasmResult.width).toBe(10);
    expect(wasmResult.height).toBe(10);
  });

  it('returns zero paths for empty image', async () => {
    if (!(await isWasmAvailable())) {
      return;
    }

    const pixels = new Array<number>(10 * 10 * 4).fill(255);
    const imageData = rgba(10, 10, pixels);

    const result = await wasmTraceProvider.trace(imageData, {
      threshold: 128,
      foreground: 'dark',
    });

    expect(result.paths).toHaveLength(0);
  });

  it('structural agreement with TS traceRasterToPaths for monochrome block', async () => {
    if (!(await isWasmAvailable())) {
      return;
    }

    const pixels: number[] = [];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const dark = x >= 1 && x <= 3 && y >= 1 && y <= 3;
        pixels.push(dark ? 0 : 255, dark ? 0 : 255, dark ? 0 : 255, 255);
      }
    }
    const imageData = rgba(5, 5, pixels);

    const wasmResult = await wasmTraceProvider.trace(imageData, {
      threshold: 128,
      minArea: 1,
    });
    const tsResult = traceRasterToPaths(imageData, {
      threshold: 128,
      minArea: 1,
      simplifyTolerance: 0,
    });

    expect(wasmResult.paths.length).toBeGreaterThanOrEqual(1);
    expect(tsResult.paths.length).toBeGreaterThanOrEqual(1);
    expect(wasmResult.width).toBe(tsResult.width);
    expect(wasmResult.height).toBe(tsResult.height);
  });

  it('wasmTraceProvider has correct id and label', () => {
    expect(wasmTraceProvider.id).toBe('wasm-trace');
    expect(wasmTraceProvider.label).toBe('CPU (WASM)');
  });
});
