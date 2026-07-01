import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import type { Scene } from './types';

const scene: Scene = {
  nodes: [
    {
      id: '1',
      name: 'r1',
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      fill: [57, 208, 198, 255],
    },
    {
      id: '2',
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

  // ── Golden IR tests — one per shape kind ─────────────────────────────────

  it('buildIr maps ellipse shape to ellipse primitive', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'e1',
          name: 'ellipse',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 30 },
          fill: [255, 0, 0, 255],
        },
      ],
    });
    expect(ir[0]?.primitive.kind).toBe('ellipse');
    const p = ir[0]?.primitive;
    expect(p).toMatchObject({ kind: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 30 });
  });

  it('buildIr maps circle shape to circle primitive', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'c1',
          name: 'circle',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'circle', cx: 25, cy: 25, r: 20 },
          fill: [0, 255, 0, 255],
        },
      ],
    });
    expect(ir[0]?.primitive).toMatchObject({ kind: 'circle', cx: 25, cy: 25, r: 20 });
  });

  it('buildIr maps line shape to line primitive', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'l1',
          name: 'line',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'line', from: [0, 0], to: [100, 100], tolerance: 1 },
          fill: [0, 0, 0, 255],
        },
      ],
    });
    expect(ir[0]?.primitive).toMatchObject({ kind: 'line', from: [0, 0], to: [100, 100] });
  });

  it('buildIr maps polygon shape to polygon primitive', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'p1',
          name: 'polygon',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'polygon', cx: 50, cy: 50, radius: 40, sides: 6, rotation: 0 },
          fill: [0, 128, 255, 255],
        },
      ],
    });
    expect(ir[0]?.primitive).toMatchObject({
      kind: 'polygon',
      cx: 50,
      cy: 50,
      radius: 40,
      sides: 6,
    });
  });

  it('buildIr maps star shape to star primitive', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 's1',
          name: 'star',
          transform: [1, 0, 0, 1, 0, 0],
          shape: {
            kind: 'star',
            cx: 50,
            cy: 50,
            innerRadius: 20,
            outerRadius: 40,
            points: 5,
            rotation: 0,
          },
          fill: [255, 200, 0, 255],
        },
      ],
    });
    expect(ir[0]?.primitive).toMatchObject({
      kind: 'star',
      cx: 50,
      cy: 50,
      innerRadius: 20,
      outerRadius: 40,
      points: 5,
    });
  });

  it('buildIr maps arrow shape to arrow primitive', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'a1',
          name: 'arrow',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'arrow', from: [0, 0], to: [100, 0], tolerance: 1, arrowheadSize: 10 },
          fill: [0, 0, 0, 255],
        },
      ],
    });
    expect(ir[0]?.primitive).toMatchObject({
      kind: 'arrow',
      from: [0, 0],
      to: [100, 0],
      arrowheadSize: 10,
    });
  });

  it('buildIr maps path shape to path primitive', async () => {
    const eng = await createEngine();
    const pts = [
      { x: 0, y: 0, handleIn: null as null, handleOut: [10, 0] as [number, number] },
      { x: 50, y: 50, handleIn: [-10, 0] as [number, number], handleOut: null as null },
    ];
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'path1',
          name: 'path',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'path', points: pts, closed: false, tolerance: 1 },
          fill: [255, 0, 255, 255],
        },
      ],
    });
    const p = ir[0]?.primitive;
    expect(p?.kind).toBe('path');
    if (p?.kind === 'path') {
      expect(p.points).toHaveLength(2);
      expect(p.closed).toBe(false);
    }
  });

  it('buildIr maps text node to text primitive', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 't1',
          name: 'text',
          kind: 'text',
          transform: [1, 0, 0, 1, 10, 20],
          fill: [0, 0, 0, 255],
          text: 'Hello world',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal',
        },
      ],
    });
    expect(ir[0]?.primitive.kind).toBe('text');
    const p = ir[0]?.primitive;
    if (p?.kind === 'text') {
      expect(p.text).toBe('Hello world');
      expect(p.fontSize).toBe(16);
    }
  });

  it('passes textAlign from scene node to IR primitive', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 't2',
          name: 'text',
          kind: 'text',
          transform: [1, 0, 0, 1, 0, 0],
          fill: [0, 0, 0, 255],
          text: 'Centered',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal',
          textAlign: 'center',
        },
      ],
    });
    const p = ir[0]?.primitive;
    if (p?.kind === 'text') {
      expect(p.textAlign).toBe('center');
    }
  });

  it('propagates letterSpacing and lineHeight to text primitive', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 't3',
          name: 'text',
          kind: 'text',
          transform: [1, 0, 0, 1, 0, 0],
          fill: [0, 0, 0, 255],
          text: 'Styled',
          fontSize: 24,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal',
          letterSpacing: 2,
          lineHeight: 1.5,
        },
      ],
    });
    const p = ir[0]?.primitive;
    if (p?.kind === 'text') {
      expect(p.letterSpacing).toBe(2);
      expect(p.lineHeight).toBe(1.5);
    }
  });

  // ── Fill stack tests ───────────────────────────────────────────────────

  it('buildIr maps fills[] to FillIR items', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'f1',
          name: 'multi-fill',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          fill: [0, 0, 0, 255],
          fills: [
            { type: 'solid', color: [255, 0, 0, 255], opacity: 1, blendMode: 'normal', visible: true },
            {
              type: 'gradient',
              gradient: {
                type: 'linear',
                stops: [
                  { position: 0, color: [255, 0, 0, 255] },
                  { position: 1, color: [0, 0, 255, 255] },
                ],
              },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      ],
    });
    expect(ir[0]?.fills).toBeDefined();
    expect(ir[0]?.fills).toHaveLength(2);
    expect(ir[0]?.fills?.[0]?.type).toBe('solid');
    expect(ir[0]?.fills?.[1]?.type).toBe('gradient');
    if (ir[0]?.fills?.[1]?.type === 'gradient') {
      expect(ir[0]?.fills?.[1]?.gradientType).toBe('linear');
    }
  });

  it('buildIr filters invisible fills from stack', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'inv',
          name: 'invisible',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
          fill: [0, 0, 0, 255],
          fills: [
            { type: 'solid', color: [255, 0, 0, 255], opacity: 1, blendMode: 'normal', visible: false },
            { type: 'solid', color: [0, 255, 0, 255], opacity: 1, blendMode: 'normal', visible: true },
          ],
        },
      ],
    });
    expect(ir[0]?.fills).toHaveLength(1);
    expect(ir[0]?.fills?.[0]?.type).toBe('solid');
    if (ir[0]?.fills?.[0]?.type === 'solid') {
      expect(ir[0]?.fills?.[0]?.color).toEqual([0, 255, 0, 255]);
    }
  });

  it('buildIr falls back to legacy fill when fills[] is empty', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'legacy',
          name: 'legacy',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
          fill: [57, 208, 198, 255],
          fills: [],
        },
      ],
    });
    expect(ir[0]?.fill).toEqual([57, 208, 198, 255]);
    expect(ir[0]?.fills).toBeUndefined();
  });

  it('buildIr skips fills[] when not present (legacy path)', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'nofills',
          name: 'no-fills',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
          fill: [0, 0, 0, 255],
        },
      ],
    });
    expect(ir[0]?.fills).toBeUndefined();
    expect(ir[0]?.fill).toEqual([0, 0, 0, 255]);
  });

  it('buildIr maps gradient fill to FillIR with stops and rotation', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'grad',
          name: 'gradient',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fill: [0, 0, 0, 255],
          fills: [
            {
              type: 'gradient',
              gradient: {
                type: 'radial',
                stops: [
                  { position: 0, color: [255, 255, 255, 255] },
                  { position: 0.5, color: [128, 128, 128, 255] },
                  { position: 1, color: [0, 0, 0, 255] },
                ],
                rotation: 45,
              },
              opacity: 0.8,
              blendMode: 'screen',
              visible: true,
            },
          ],
        },
      ],
    });
    expect(ir[0]?.fills).toHaveLength(1);
    const f = ir[0]?.fills?.[0];
    expect(f?.type).toBe('gradient');
    if (f?.type === 'gradient') {
      expect(f.gradientType).toBe('radial');
      expect(f.stops).toHaveLength(3);
      expect(f.rotation).toBe(45);
      expect(f.opacity).toBe(0.8);
      expect(f.blendMode).toBe('screen');
    }
  });

  it('buildIr preserves opacity and blendMode on IR items', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'o1',
          name: 'fade',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          fill: [255, 0, 0, 255],
          opacity: 0.5,
          blendMode: 'multiply',
        },
      ],
    });
    expect(ir[0]?.opacity).toBe(0.5);
    expect(ir[0]?.blendMode).toBe('multiply');
  });
});
