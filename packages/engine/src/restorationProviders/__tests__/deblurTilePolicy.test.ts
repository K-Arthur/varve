import { describe, expect, it, vi } from 'vitest';
import { dispatchRestorationTask } from '../dispatch';

describe('deblur adaptive tile policy', () => {
  it('runs small images single-shot', async () => {
    // Mock the orchestrator to capture the tile policy.
    const mod = await import('../tiledRestoration');
    const spy = vi.spyOn(mod, 'runTiledRestoration').mockResolvedValue({
      imageData: new ImageData(10, 10),
      processingTimeMs: 1,
      executionProvider: 'mock',
      tilesUsed: 1,
    });
    await dispatchRestorationTask(new ImageData(1000, 700), 'deblur', 0.7);
    expect(spy).toHaveBeenCalledWith(
      expect.any(ImageData),
      expect.objectContaining({ tileSize: 1008, overlap: 0 }),
    );
    spy.mockRestore();
  });

  it('uses the budget-safe tiled policy for large images', async () => {
    const mod = await import('../tiledRestoration');
    const spy = vi.spyOn(mod, 'runTiledRestoration').mockResolvedValue({
      imageData: new ImageData(10, 10),
      processingTimeMs: 1,
      executionProvider: 'mock',
      tilesUsed: 4,
    });
    await dispatchRestorationTask(new ImageData(2400, 1600), 'deblur', 0.7);
    expect(spy).toHaveBeenCalledWith(
      expect.any(ImageData),
      expect.objectContaining({ tileSize: 1280, overlap: 256 }),
    );
    spy.mockRestore();
  });
});
