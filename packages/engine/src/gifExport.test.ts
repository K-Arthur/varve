import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkGifExportSupport, exportTimelineToGif, type GifFrameRenderer } from './gifExport';

function solidRgbaFrame(
  r: number,
  g: number,
  b: number,
  a: number,
  w: number,
  h: number,
): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    rgba[off] = r;
    rgba[off + 1] = g;
    rgba[off + 2] = b;
    rgba[off + 3] = a;
  }
  return rgba;
}

describe('checkGifExportSupport', () => {
  it('returns supported when OffscreenCanvas is available', () => {
    const result = checkGifExportSupport();
    expect(result.supported).toBe(true);
  });
});

describe('exportTimelineToGif', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects zero-size dimensions', async () => {
    const renderer: GifFrameRenderer = async () => new Uint8Array(0);
    const result = await exportTimelineToGif(renderer, 1000, {
      width: 0,
      height: 0,
      fps: 10,
    });
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/Invalid dimensions/);
    expect(result.bytes).toBeNull();
  });

  it('produces a valid GIF with a single frame', async () => {
    const renderer: GifFrameRenderer = async () => solidRgbaFrame(255, 0, 0, 255, 4, 4);
    const result = await exportTimelineToGif(renderer, 100, {
      width: 4,
      height: 4,
      fps: 10,
    });

    expect(result.supported).toBe(true);
    expect(result.frameCount).toBe(1);
    expect(result.bytes).not.toBeNull();
    expect(result.bytes!.byteLength).toBeGreaterThan(0);

    // Validate GIF89a header
    const header = result.bytes!.slice(0, 6);
    expect(Array.from(header)).toEqual([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    // Validate trailer
    expect(result.bytes![result.bytes!.byteLength - 1]).toBe(0x3b);
  });

  it('produces a multi-frame GIF when duration spans multiple frames', async () => {
    const frame = solidRgbaFrame(0, 255, 0, 255, 8, 8);
    const renderer: GifFrameRenderer = async () => frame;
    const result = await exportTimelineToGif(renderer, 1000, {
      width: 8,
      height: 8,
      fps: 10,
    });

    expect(result.supported).toBe(true);
    expect(result.frameCount).toBe(10);
    expect(result.bytes).not.toBeNull();
    expect(result.bytes!.byteLength).toBeGreaterThan(0);

    const header = result.bytes!.slice(0, 6);
    expect(Array.from(header)).toEqual([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  });

  it('handles transparent pixels', async () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    // All fully transparent
    const renderer: GifFrameRenderer = async () => rgba;
    const result = await exportTimelineToGif(renderer, 100, {
      width: 4,
      height: 4,
      fps: 10,
    });

    expect(result.supported).toBe(true);
    expect(result.bytes).not.toBeNull();
    expect(result.bytes!.byteLength).toBeGreaterThan(0);
  });

  it('cancels on abort signal', async () => {
    const renderer: GifFrameRenderer = async () => solidRgbaFrame(0, 0, 255, 255, 4, 4);
    const controller = new AbortController();

    const promise = exportTimelineToGif(renderer, 5000, {
      width: 4,
      height: 4,
      fps: 30,
      signal: controller.signal,
    });

    controller.abort();
    const result = await promise;

    expect(result.supported).toBe(false);
    expect(result.reason).toBe('Cancelled');
    expect(result.bytes).toBeNull();
  });

  it('calls onProgress for each frame', async () => {
    const frame = solidRgbaFrame(128, 128, 128, 255, 2, 2);
    const renderer: GifFrameRenderer = async () => frame;
    const onProgress = vi.fn();

    await exportTimelineToGif(renderer, 500, {
      width: 2,
      height: 2,
      fps: 10,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(5);
    expect(onProgress).toHaveBeenLastCalledWith(5, 5);
  });

  it('handles Uint8Array source frames correctly', async () => {
    const frame = solidRgbaFrame(0, 128, 255, 255, 4, 4);
    const renderer: GifFrameRenderer = async () => frame;
    const result = await exportTimelineToGif(renderer, 100, {
      width: 4,
      height: 4,
      fps: 10,
    });

    expect(result.supported).toBe(true);
    expect(result.bytes).not.toBeNull();
    expect(result.bytes!.byteLength).toBeGreaterThan(0);
  });
});
