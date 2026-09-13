import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFontDetectionImage, normalizedCrop } from './fontDetectImage';

describe('font detection image extraction', () => {
  const drawImage = vi.fn();
  const context = {
    save: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage,
    restore: vi.fn(),
    getImageData: vi.fn(() => new ImageData(80, 40)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 400;
        naturalHeight = 200;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  });

  it('clamps malformed crop coordinates to the decoded source', () => {
    expect(normalizedCrop({ x: -10, y: 190, w: 500, h: -4 }, 400, 200)).toEqual({
      x: 0,
      y: 190,
      w: 400,
      h: 1,
    });
  });

  it('draws only the selected crop and applies the image transform', async () => {
    await loadFontDetectionImage('data:image/png;base64,fixture', {
      crop: { x: 40, y: 20, w: 120, h: 80 },
      rotation: 90,
      flipH: true,
      flipV: true,
    });

    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      40,
      20,
      120,
      80,
      expect.any(Number),
      expect.any(Number),
      120,
      80,
    );
    expect(context.rotate).toHaveBeenCalledWith(expect.closeTo(Math.PI / 2, 6));
    expect(context.scale).toHaveBeenCalledWith(-1, -1);
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 80, 120);
  });
});
