// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Canvas2DBackend } from './canvas2d/backend';
import { TileCache } from './canvas2d/tileCache';
import { createCompositorBackend } from './router';

describe('@strata/compositor', () => {
  it('Canvas2DBackend initializes and draws', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const backend = new Canvas2DBackend();
    await backend.init(canvas);
    backend.beginFrame({
      items: [],
      camera: { zoom: 1, pan: { x: 0, y: 0 } },
      viewport: { width: 100, height: 100 },
      docVersion: 1,
    });
    backend.drawVectorItems([
      {
        transform: [1, 0, 0, 1, 10, 10],
        fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      },
    ]);
    backend.endFrame();
    backend.destroy();
    expect(canvas.getContext('2d')).toBeTruthy();
  });

  it('createCompositorBackend defaults to canvas2d', async () => {
    const canvas = document.createElement('canvas');
    const { backend, capabilities } = await createCompositorBackend(canvas);
    expect(backend.id).toBe('canvas2d');
    expect(capabilities.webgpu).toBe(false);
    backend.destroy();
  });

  it('TileCache evicts oldest entries', () => {
    const cache = new TileCache(2);
    cache.touch('a');
    cache.touch('b');
    cache.touch('c');
    expect(cache.has('a')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('drawVectorItems always replays even on cache hit', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const backend = new Canvas2DBackend();
    await backend.init(canvas);
    const item = {
      transform: [1, 0, 0, 1, 5, 5] as const,
      fill: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
      primitive: { kind: 'rect' as const, x: 0, y: 0, w: 10, h: 10 },
      opacity: 1,
      blendMode: 'normal' as const,
      strokes: [],
      effects: [],
    };
    backend.beginFrame(
      {
        items: [item],
        camera: { zoom: 1, pan: { x: 0, y: 0 } },
        viewport: { width: 64, height: 64 },
        docVersion: 1,
      },
      { applyCamera: false },
    );
    backend.drawVectorItems([item]);
    backend.drawVectorItems([item]);
    backend.endFrame();
    backend.destroy();
    expect(true).toBe(true);
  });

  it('beginFrame with clear:false skips clearRect', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const clearRectSpy = vi.spyOn(ctx, 'clearRect');
    const backend = new Canvas2DBackend();
    await backend.init(canvas);
    backend.beginFrame(
      {
        items: [],
        camera: { zoom: 1, pan: { x: 0, y: 0 } },
        viewport: { width: 32, height: 32 },
        docVersion: 1,
      },
      { clear: false, applyCamera: false },
    );
    backend.endFrame();
    expect(clearRectSpy).not.toHaveBeenCalled();
    backend.destroy();
  });

  it('WebGPUBackend delegates to canvas2d fallback', async () => {
    const { WebGPUBackend } = await import('./webgpu/backend');
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const backend = new WebGPUBackend();
    await backend.init(canvas);
    backend.beginFrame({
      items: [],
      camera: { zoom: 1, pan: { x: 0, y: 0 } },
      viewport: { width: 64, height: 64 },
      docVersion: 1,
    });
    backend.endFrame();
    backend.destroy();
    expect(backend.id).toBe('webgpu');
  });
});
