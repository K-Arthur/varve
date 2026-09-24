/**
 * Tile-based export for oversized canvases.
 */
import { describe, expect, it, type Mock, vi } from 'vitest';
import { getCanvasSizeLimit, streamTiledExport, tiledExport, writeTiledExport } from '../export';

describe('getCanvasSizeLimit', () => {
  it('returns 32767 for chromium', () => {
    expect(getCanvasSizeLimit('chromium')).toBe(32767);
  });

  it('returns 16384 for webkit', () => {
    expect(getCanvasSizeLimit('webkit')).toBe(16384);
  });

  it('returns 32767 for gecko', () => {
    expect(getCanvasSizeLimit('gecko')).toBe(32767);
  });

  it('defaults to 16384 for unknown engine', () => {
    expect(getCanvasSizeLimit('unknown-engine' as never)).toBe(16384);
  });
});

describe('tiledExport', () => {
  function makeRenderFn(spy?: Mock<(v: { x: number; y: number; w: number; h: number }) => void>) {
    return (viewport: { x: number; y: number; w: number; h: number }, _dpr: number): ImageData => {
      const img = new ImageData(viewport.w, viewport.h);
      // Fill with a distinguishable pattern: top-left pixel gets tile offset
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = viewport.x % 256;
        img.data[i + 1] = viewport.y % 256;
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
      spy?.(viewport);
      return img;
    };
  }

  it('sub-limit document produces single tile (one renderFn call)', async () => {
    const fn = vi.fn();
    const render = makeRenderFn(fn);
    const result = await tiledExport({ totalW: 800, totalH: 600, dpr: 1 }, render, 'webkit');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ x: 0, y: 0, w: 800, h: 600 });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('oversized document produces at least 2 tiles', { timeout: 60_000 }, async () => {
    // 60s timeout: 20000x20000 @ dpr 2 allocates multi-GB ImageData tiles;
    // on loaded CI/parallel-agent hosts the default 5s is routinely exceeded.
    // This is a correctness assertion (tile count), not a perf gate.
    const fn = vi.fn();
    const render = makeRenderFn(fn);
    await tiledExport({ totalW: 20000, totalH: 20000, dpr: 2 }, render, 'webkit');

    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('tiles cover full area with no gaps', async () => {
    // Use a small limit to force many tiles
    const calls: { x: number; y: number; w: number; h: number }[] = [];
    const captureFn = (vp: { x: number; y: number; w: number; h: number }) => {
      calls.push({ ...vp });
    };

    const w = 500;
    const h = 500;

    await tiledExport(
      { totalW: w, totalH: h, dpr: 1 },
      (vp) => {
        captureFn(vp);
        const img = new ImageData(vp.w, vp.h);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = 0;
          img.data[i + 1] = 64;
          img.data[i + 2] = 128;
          img.data[i + 3] = 255;
        }
        return img;
      },
      'chromium',
    );

    // Actually let's just verify the tiled result has the right dimensions
    // and all pixels are non-zero (filled by tiles)
    const fn2 = vi.fn().mockImplementation((vp: { x: number; y: number; w: number; h: number }) => {
      const img = new ImageData(vp.w, vp.h);
      for (let i = 0; i < img.data.length; i++) {
        img.data[i] = 255;
      }
      return img;
    });

    const result = await tiledExport(
      { totalW: 400, totalH: 400, dpr: 1 },
      fn2,
      // WebKit limit is 16384, so 400x400 won't tile — let's force tiling by
      // coercing through the code path.
      // Actually 400x400 < 16384 so it takes the single-tile path.
      // To force tiling we need total > limit. Use a small custom limit by
      // passing a fake engine type... or just make totalW/totalH > 16384.
      // For a proper gap test, use a large document.
    );
    expect(result.width).toBe(400);
    expect(result.height).toBe(400);

    // Now test a genuinely tiled scenario: 20000x1 forces cols > 1
    const narrowCalls: { x: number; y: number; w: number; h: number }[] = [];
    const narrow = await tiledExport(
      { totalW: 30000, totalH: 1, dpr: 1 },
      (vp) => {
        narrowCalls.push({ ...vp });
        return new ImageData(vp.w, vp.h);
      },
      'webkit',
    );
    expect(narrow.width).toBe(30000);
    expect(narrow.height).toBe(1);

    // Verify tiles are contiguous with no gaps
    let coveredX = 0;
    for (const c of narrowCalls.sort((a, b) => a.x - b.x)) {
      expect(c.x).toBe(coveredX);
      coveredX += c.w;
    }
    expect(coveredX).toBe(30000);
  });
});

describe('streamTiledExport', () => {
  it('yields each tile to a bounded consumer in row-major order', async () => {
    const seen: Array<{ x: number; y: number }> = [];
    for await (const tile of streamTiledExport(
      { totalW: 20_000, totalH: 1, dpr: 1 },
      (viewport) => {
        seen.push({ x: viewport.x, y: viewport.y });
        return new ImageData(viewport.w, viewport.h);
      },
      'webkit',
    )) {
      expect(tile.image.width).toBe(tile.viewport.w);
    }
    expect(seen).toEqual([
      { x: 0, y: 0 },
      { x: 16_384, y: 0 },
    ]);
  });

  it('rejects invalid dimensions and invalid DPR before rendering', async () => {
    const render = vi.fn(
      (viewport: { w: number; h: number }) => new ImageData(viewport.w, viewport.h),
    );

    await expect(async () => {
      for await (const _tile of streamTiledExport({ totalW: 0, totalH: 1, dpr: 1 }, render)) {
        // Consume the iterator to run its validation.
      }
    }).rejects.toThrow('Tile export width must be a positive safe integer');
    await expect(async () => {
      for await (const _tile of streamTiledExport(
        { totalW: 1, totalH: 1, dpr: Number.NaN },
        render,
      )) {
        // Consume the iterator to run its validation.
      }
    }).rejects.toThrow('Tile export DPR must be a finite positive number');
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects a renderer result whose pixel dimensions do not match its tile', async () => {
    await expect(async () => {
      for await (const _tile of streamTiledExport(
        { totalW: 2, totalH: 1, dpr: 1 },
        () => new ImageData(1, 1),
        'webkit',
      )) {
        // Consume the iterator to run its render contract.
      }
    }).rejects.toThrow('Tile renderer returned 1x1; expected 2x1');
  });
});

describe('writeTiledExport', () => {
  it('waits for the consumer before rendering the next tile', async () => {
    const renderedX: number[] = [];
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const writing = writeTiledExport(
      { totalW: 20_000, totalH: 1, dpr: 1 },
      (viewport) => {
        renderedX.push(viewport.x);
        return new ImageData(viewport.w, viewport.h);
      },
      async (tile) => {
        if (tile.column === 0) await firstWrite;
      },
      'webkit',
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderedX).toEqual([0]);
    releaseFirstWrite();
    await writing;
    expect(renderedX).toEqual([0, 16_384]);
  });
});
