// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeMaskResult } from '../finalizeMask';
import type { BackgroundRemovalResult } from '../types';

// Mock decodeMaskDataUrl to return a controlled mask
vi.mock('../maskDecode', () => ({
  decodeMaskDataUrl: vi.fn(),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeResult(_mask: Uint8Array, width: number, height: number): BackgroundRemovalResult {
  return {
    maskDataUrl: 'data:image/png;base64,fake',
    confidence: 0.9,
    method: 'ai-balanced',
    processingTimeMs: 100,
    width,
    height,
  };
}

describe('finalizeMaskResult', () => {
  it('returns needsSubjectPicker: false when only one significant component', async () => {
    const { decodeMaskDataUrl } = await import('../maskDecode');
    // 100x100 image, one large blob (500 pixels) and noise (1 pixel each)
    const mask = new Uint8Array(100 * 100);
    // Large blob: 500 pixels in a block
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < 20; x++) {
        mask[y * 100 + x] = 255;
      }
    }
    // Tiny noise: 3 scattered pixels
    mask[9999] = 200;
    mask[9998] = 200;
    mask[9997] = 200;

    vi.mocked(decodeMaskDataUrl).mockResolvedValue({ mask, width: 100, height: 100 });

    const result = await finalizeMaskResult(makeResult(mask, 100, 100));
    // Only 1 significant component (500px >= minArea), noise filtered out
    expect(result.needsSubjectPicker).toBe(false);
    expect(result.components).toHaveLength(1);
  });

  it('returns needsSubjectPicker: true when multiple significant components exist', async () => {
    const { decodeMaskDataUrl } = await import('../maskDecode');
    // 100x100 image, two large blobs
    const mask = new Uint8Array(100 * 100);
    // Blob 1: 200 pixels
    for (let i = 0; i < 200; i++) mask[i] = 255;
    // Blob 2: 200 pixels
    for (let i = 8000; i < 8200; i++) mask[i] = 255;

    vi.mocked(decodeMaskDataUrl).mockResolvedValue({ mask, width: 100, height: 100 });

    const result = await finalizeMaskResult(makeResult(mask, 100, 100), {
      promptIfMultiple: true,
    });
    expect(result.needsSubjectPicker).toBe(true);
    expect(result.components).toHaveLength(2);
  });

  it('filters out noise components below minimum threshold', async () => {
    const { decodeMaskDataUrl } = await import('../maskDecode');
    // 1000x1000 image → minArea = max(50, 1000) = 1000
    const mask = new Uint8Array(1000 * 1000);
    // Large blob: 5000 pixels
    for (let i = 0; i < 5000; i++) mask[i] = 255;
    // Noise: 10 scattered 1-pixel blobs
    for (let i = 0; i < 10; i++) mask[999000 + i * 10] = 200;

    vi.mocked(decodeMaskDataUrl).mockResolvedValue({ mask, width: 1000, height: 1000 });

    const result = await finalizeMaskResult(makeResult(mask, 1000, 1000), {
      promptIfMultiple: true,
    });
    // Only 1 significant component (5000px >= 1000), noise filtered
    expect(result.needsSubjectPicker).toBe(false);
    expect(result.components).toHaveLength(1);
  });

  it('auto-keeps largest when not prompting and multiple exist', async () => {
    const { decodeMaskDataUrl } = await import('../maskDecode');
    const mask = new Uint8Array(100 * 100);
    // Blob 1: 500 pixels
    for (let i = 0; i < 500; i++) mask[i] = 255;
    // Blob 2: 300 pixels
    for (let i = 5000; i < 5300; i++) mask[i] = 255;

    vi.mocked(decodeMaskDataUrl).mockResolvedValue({ mask, width: 100, height: 100 });

    const result = await finalizeMaskResult(makeResult(mask, 100, 100), {
      promptIfMultiple: false,
    });
    expect(result.needsSubjectPicker).toBe(false);
    // Mask should be filtered to only the largest component
    expect(result.maskDataUrl).not.toBe('data:image/png;base64,fake');
  });
});
