import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import type { Scene } from './types';

const scene: Scene = {
  nodes: [
    {
      id: 1,
      name: 'r1',
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      fill: [57, 208, 198, 255],
    },
    {
      id: 2,
      name: 'r2',
      transform: [1, 0, 0, 1, 5, 5],
      shape: { kind: 'rect', x: 0, y: 0, w: 3, h: 3 },
      fill: [255, 0, 0, 255],
    },
  ],
};

describe('createEngine (stub)', () => {
  it('returns a stub engine by default (no Tauri in test env)', async () => {
    const eng = await createEngine();
    expect(eng.backend).toBe('stub');
  });

  it('buildIr maps one node to one IR item preserving fill + transform', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr(scene);
    expect(ir).toHaveLength(2);
    expect(ir[0]?.fill).toEqual([57, 208, 198, 255]);
    expect(ir[0]?.primitive.kind).toBe('rect');
    expect(ir[1]?.transform[4]).toBe(5); // translate x preserved
  });

  it('hitTest returns the topmost node index', async () => {
    const eng = await createEngine();
    expect(await eng.hitTest(scene, [6, 6])).toBe(1); // inside r2
    expect(await eng.hitTest(scene, [2, 2])).toBe(0); // only r1
    expect(await eng.hitTest(scene, [99, 99])).toBeNull();
  });

  it('buildIr of an empty scene is empty', async () => {
    const eng = await createEngine();
    expect(await eng.buildIr({ nodes: [] })).toEqual([]);
  });
});
