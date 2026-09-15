import { describe, expect, it, vi } from 'vitest';
import { applyWorkerCamera, workerBitmapDelta } from './workerCamera';

describe('applyWorkerCamera', () => {
  it('applies DPR, pan, viewport-centred rotation, and zoom in main-thread order', () => {
    const calls: string[] = [];
    const target = {
      setTransform: vi.fn((a, b, c, d, e, f) => calls.push(`matrix:${a},${b},${c},${d},${e},${f}`)),
      translate: vi.fn((x, y) => calls.push(`translate:${x},${y}`)),
      rotate: vi.fn((radians) => calls.push(`rotate:${radians}`)),
      scale: vi.fn((x, y) => calls.push(`scale:${x},${y}`)),
    };

    applyWorkerCamera(target, { pan: { x: 12, y: -8 }, zoom: 1.5, rotation: Math.PI / 4 }, 2, {
      width: 800,
      height: 600,
    });

    expect(calls).toEqual([
      'matrix:2,0,0,2,0,0',
      'translate:12,-8',
      'translate:400,300',
      `rotate:${Math.PI / 4}`,
      'translate:-400,-300',
      'scale:1.5,1.5',
    ]);
  });
});

describe('workerBitmapDelta', () => {
  it('maps pan and zoom changes in physical pixels', () => {
    const delta = workerBitmapDelta(
      { pan: { x: 10, y: 20 }, zoom: 1, rotation: 0 },
      { pan: { x: 30, y: 10 }, zoom: 2, rotation: 0 },
      { width: 800, height: 600 },
      2,
    );
    expect(delta).not.toBeNull();
    expect(delta?.[0]).toBeCloseTo(2);
    expect(delta?.[3]).toBeCloseTo(2);
    expect(delta?.[4]).toBeCloseTo(20);
    expect(delta?.[5]).toBeCloseTo(-60);
  });

  it('maps camera rotation instead of displaying a stale unrotated frame', () => {
    const delta = workerBitmapDelta(
      { pan: { x: 0, y: 0 }, zoom: 1, rotation: 0 },
      { pan: { x: 0, y: 0 }, zoom: 1, rotation: Math.PI / 2 },
      { width: 800, height: 600 },
      1,
    );
    expect(delta?.[1]).toBeCloseTo(1);
    expect(delta?.[2]).toBeCloseTo(-1);
  });
});
