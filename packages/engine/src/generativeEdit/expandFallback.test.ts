import { describe, expect, it } from 'vitest';
import { chooseExpandGenerationStrategy, runDeterministicExpandFallback } from './expandFallback';
import { runGenerativeEdit } from './pipeline';

function expandedFrame(): {
  imageData: ImageData;
  mask: Uint8Array;
  sourceX: number;
  sourceY: number;
} {
  const width = 14;
  const height = 12;
  const sourceX = 3;
  const sourceY = 2;
  const sourceWidth = 8;
  const sourceHeight = 7;
  const imageData = new ImageData(width, height);
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceLocalX = Math.max(0, Math.min(sourceWidth - 1, x - sourceX));
      const sourceLocalY = Math.max(0, Math.min(sourceHeight - 1, y - sourceY));
      const offset = (y * width + x) * 4;
      imageData.data[offset] = 20 + sourceLocalX * 17;
      imageData.data[offset + 1] = 30 + sourceLocalY * 19;
      imageData.data[offset + 2] = 80 + ((sourceLocalX + sourceLocalY) % 5) * 11;
      imageData.data[offset + 3] = 255;
      const insideSource =
        x >= sourceX && x < sourceX + sourceWidth && y >= sourceY && y < sourceY + sourceHeight;
      mask[y * width + x] = insideSource ? 0 : 255;
    }
  }

  return { imageData, mask, sourceX, sourceY };
}

function sourcePixels(frame: ReturnType<typeof expandedFrame>): number[] {
  const values: number[] = [];
  const { imageData, sourceX, sourceY } = frame;
  const sourceWidth = 8;
  const sourceHeight = 7;
  for (let y = sourceY; y < sourceY + sourceHeight; y += 1) {
    for (let x = sourceX; x < sourceX + sourceWidth; x += 1) {
      const offset = (y * imageData.width + x) * 4;
      values.push(...imageData.data.slice(offset, offset + 4));
    }
  }
  return values;
}

describe('deterministic Expand fallback', () => {
  it('uses a shared model frame while the coherence budget allows it', () => {
    expect(chooseExpandGenerationStrategy(512, 512, 'ai', true)).toBe('coherent-full-frame');
    expect(chooseExpandGenerationStrategy(1024, 1025, 'ai', true)).toBe('staged-border');
    expect(chooseExpandGenerationStrategy(512, 512, 'fast', false)).toBe('coherent-full-frame');
    expect(chooseExpandGenerationStrategy(513, 513, 'ai', false)).toBe('staged-border');
  });

  it('fills the requested frame while preserving every source pixel', async () => {
    const frame = expandedFrame();
    const result = await runDeterministicExpandFallback({
      imageData: frame.imageData,
      mask: frame.mask,
      quality: 'fast',
      seed: 17,
    });

    expect([result.width, result.height]).toEqual([14, 12]);
    expect(sourcePixels({ ...frame, imageData: result.imageData })).toEqual(sourcePixels(frame));
    expect(result.filledBounds).toEqual({ x: 0, y: 0, w: 14, h: 12 });
    expect(result.warnings.join(' ')).toMatch(/promptless local reconstruction/i);
  });

  it('is reachable through the generative edit facade without a prompt provider', async () => {
    const frame = expandedFrame();
    const result = await runGenerativeEdit({
      mode: 'expand',
      imageData: frame.imageData,
      mask: frame.mask,
      maskWidth: frame.imageData.width,
      maskHeight: frame.imageData.height,
      quality: 'draft',
      seed: 23,
    });

    expect(result.mode).toBe('expand');
    expect(result.provider.runtime).toBe('patchmatch');
    expect(sourcePixels({ ...frame, imageData: result.imageData })).toEqual(sourcePixels(frame));
  });

  it('rejects an aborted request before allocating the guarded frame', async () => {
    const frame = expandedFrame();
    const controller = new AbortController();
    controller.abort();

    await expect(
      runDeterministicExpandFallback({
        imageData: frame.imageData,
        mask: frame.mask,
        quality: 'fast',
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/i);
  });
});
