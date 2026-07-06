// @vitest-environment jsdom

import type { RenderItem } from '@strata/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DBackend } from '../canvas2d/backend';
import { WebGPUBackend } from './backend';

const FIXTURE_ITEMS: RenderItem[] = [
  {
    transform: [1, 0, 0, 1, 10, 10],
    fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
    primitive: { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  },
  {
    transform: [1, 0, 0, 1, 50, 50],
    fill: { space: 'rgb', r: 200, g: 50, b: 50, a: 255 },
    primitive: { kind: 'circle', cx: 0, cy: 0, r: 15 },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  },
  {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 30, g: 30, b: 200, a: 255 },
    primitive: { kind: 'line', from: [5, 5], to: [90, 90], tolerance: 4 },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  },
];

function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let diff = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 4) {
    const a0 = a[i];
    if (a0 === undefined) break;
    const a1 = a[i + 1];
    if (a1 === undefined) break;
    const a2 = a[i + 2];
    if (a2 === undefined) break;
    const a3 = a[i + 3];
    if (a3 === undefined) break;
    const b0 = b[i];
    if (b0 === undefined) break;
    const b1 = b[i + 1];
    if (b1 === undefined) break;
    const b2 = b[i + 2];
    if (b2 === undefined) break;
    const b3 = b[i + 3];
    if (b3 === undefined) break;
    diff += Math.abs(a0 - b0) + Math.abs(a1 - b1) + Math.abs(a2 - b2) + Math.abs(a3 - b3);
  }
  return diff / (n / 4);
}

describe('WebGPU golden diff vs Canvas2D', () => {
  const frame = {
    items: FIXTURE_ITEMS,
    camera: { zoom: 1, pan: { x: 0, y: 0 } },
    viewport: { width: 128, height: 128 },
    docVersion: 1,
  };

  it('fallback path matches Canvas2D for rect+circle+line', async () => {
    const canvasRef = document.createElement('canvas');
    canvasRef.width = 128;
    canvasRef.height = 128;
    const c2d = new Canvas2DBackend();
    await c2d.init(canvasRef);
    c2d.beginFrame(frame, { applyCamera: false });
    c2d.drawVectorItems(FIXTURE_ITEMS);
    c2d.endFrame();
    const ref = canvasRef.getContext('2d')!.getImageData(0, 0, 128, 128).data;

    const canvasGpu = document.createElement('canvas');
    canvasGpu.width = 128;
    canvasGpu.height = 128;
    const wgpu = new WebGPUBackend();
    await wgpu.init(canvasGpu);
    wgpu.beginFrame(frame, { applyCamera: false });
    wgpu.drawVectorItems(FIXTURE_ITEMS);
    wgpu.endFrame();
    const out = canvasGpu.getContext('2d')!.getImageData(0, 0, 128, 128).data;

    expect(pixelDiff(ref, out)).toBeLessThan(8);
    c2d.destroy();
    wgpu.destroy();
  });

  it.skipIf(typeof (navigator as Navigator & { gpu?: GPU }).gpu === 'undefined')(
    'native WebGPU path renders without error',
    async () => {
      const canvasGpu = document.createElement('canvas');
      canvasGpu.width = 128;
      canvasGpu.height = 128;
      const wgpu = new WebGPUBackend();
      await wgpu.init(canvasGpu);
      wgpu.beginFrame(frame, { applyCamera: false, clear: true });
      wgpu.drawVectorItems(FIXTURE_ITEMS);
      wgpu.endFrame();
      wgpu.destroy();
      expect(true).toBe(true);
    },
  );
});
