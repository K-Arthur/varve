import { describe, expect, it, vi } from 'vitest';
import { createEngine, type Engine, withStubFallback } from './engine';
import type { Scene } from './types';

const scene: Scene = {
  nodes: [
    {
      id: '1',
      name: 'r1',
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
    },
    {
      id: '2',
      name: 'r2',
      transform: [1, 0, 0, 1, 5, 5],
      shape: { kind: 'rect', x: 0, y: 0, w: 3, h: 3 },
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
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
    expect(ir[0]?.fill).toEqual({ space: 'rgb', r: 57, g: 208, b: 198, a: 255 });
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
          fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
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
          fill: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
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
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
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
          fill: { space: 'rgb', r: 0, g: 128, b: 255, a: 255 },
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
          fill: { space: 'rgb', r: 255, g: 200, b: 0, a: 255 },
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
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
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
          fill: { space: 'rgb', r: 255, g: 0, b: 255, a: 255 },
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
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
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

  it('uses content-aware text sizing instead of hardcoded w/h', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 't1',
          name: 't1',
          kind: 'text',
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          text: 'Hello world',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal',
        },
        {
          id: 't2',
          name: 't2',
          kind: 'text',
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          text: 'A',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal',
        },
        {
          id: 't3',
          name: 't3',
          kind: 'text',
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          text: '',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal',
        },
      ],
    });
    const t1 = ir[0]?.primitive;
    const t2 = ir[1]?.primitive;
    const t3 = ir[2]?.primitive;
    if (t1?.kind === 'text' && t2?.kind === 'text' && t3?.kind === 'text') {
      // "Hello world" (11 chars) should be wider than "A" (1 char)
      expect(t1.w).toBeGreaterThan(t2.w);
      // Empty text should have at least minimum width
      expect(t3.w).toBeGreaterThanOrEqual(16);
      // Height should use lineHeight multiplier
      expect(t1.h).toBeCloseTo(16 * (t1.lineHeight ?? 1.4), 0);
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
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
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

  it('uses explicit area-text dimensions instead of measured point-text bounds', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'area-text',
          name: 'Area text',
          kind: 'text',
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          text: 'Short',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal',
          textMode: 'area',
          w: 240,
          h: 120,
        },
      ],
    });
    const primitive = ir[0]?.primitive;
    expect(primitive?.kind).toBe('text');
    if (primitive?.kind === 'text') {
      expect(primitive.w).toBe(240);
      expect(primitive.h).toBe(120);
      expect(primitive.textMode).toBe('area');
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
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
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

  it('preserves richText, variableAxes, and openTypeFeatures on text primitive', async () => {
    const eng = await createEngine();
    const richText = {
      paragraphs: [
        {
          runs: [
            { text: 'Hello ', format: { fontWeight: 400 } },
            { text: 'World', format: { fontWeight: 700, fontSize: 20 } },
          ],
        },
      ],
    };
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 't4',
          name: 'rich',
          kind: 'text',
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          text: 'Hello World',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal',
          richText,
          variableAxes: { wght: 500, wdth: 75 },
          openTypeFeatures: { liga: true, kern: true },
        },
      ],
    });
    const p = ir[0]?.primitive;
    expect(p?.kind).toBe('text');
    if (p?.kind === 'text') {
      expect(p.richText).toEqual(richText);
      expect(p.variableAxes).toEqual({ wght: 500, wdth: 75 });
      expect(p.openTypeFeatures).toEqual({ liga: true, kern: true });
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
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'solid',
              color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
            {
              type: 'gradient',
              gradient: {
                type: 'linear',
                stops: [
                  { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
                  { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
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
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'solid',
              color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
              opacity: 1,
              blendMode: 'normal',
              visible: false,
            },
            {
              type: 'solid',
              color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      ],
    });
    expect(ir[0]?.fills).toHaveLength(1);
    expect(ir[0]?.fills?.[0]?.type).toBe('solid');
    if (ir[0]?.fills?.[0]?.type === 'solid') {
      expect(ir[0]?.fills?.[0]?.color).toEqual({ space: 'rgb', r: 0, g: 255, b: 0, a: 255 });
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
          fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
          fills: [],
        },
      ],
    });
    expect(ir[0]?.fill).toEqual({ space: 'rgb', r: 57, g: 208, b: 198, a: 255 });
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
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        },
      ],
    });
    expect(ir[0]?.fills).toBeUndefined();
    expect(ir[0]?.fill).toEqual({ space: 'rgb', r: 0, g: 0, b: 0, a: 255 });
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
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'gradient',
              gradient: {
                type: 'radial',
                stops: [
                  { position: 0, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
                  { position: 0.5, color: { space: 'rgb', r: 128, g: 128, b: 128, a: 255 } },
                  { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
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
          fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 0.5,
          blendMode: 'multiply',
        },
      ],
    });
    expect(ir[0]?.opacity).toBe(0.5);
    expect(ir[0]?.blendMode).toBe('multiply');
  });

  it('buildIr maps image fill to FillIR image type', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'img1',
          name: 'img',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'image',
              image: { src: 'photo.png', fit: 'fill', x: 0, y: 0, scale: 1 },
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      ],
    });
    expect(ir[0]?.fills).toHaveLength(1);
    const f = ir[0]?.fills?.[0];
    expect(f?.type).toBe('image');
    if (f?.type === 'image') {
      expect(f.src).toBe('photo.png');
      expect(f.fit).toBe('fill');
    }
  });

  it('buildIr maps pattern fill to FillIR pattern type', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'pat1',
          name: 'pat',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'pattern',
              pattern: { tileSrc: 'tile.png', spacing: 4, rotation: 0 },
              opacity: 0.8,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      ],
    });
    expect(ir[0]?.fills).toHaveLength(1);
    const f = ir[0]?.fills?.[0];
    expect(f?.type).toBe('pattern');
    if (f?.type === 'pattern') {
      expect(f.tileSrc).toBe('tile.png');
      expect(f.spacing).toBe(4);
    }
  });

  it('buildIr filters invisible image fill', async () => {
    const eng = await createEngine();
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'inv1',
          name: 'inv',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'image',
              image: { src: 'hidden.png', fit: 'fill', x: 0, y: 0, scale: 1 },
              opacity: 1,
              blendMode: 'normal',
              visible: false,
            },
          ],
        },
      ],
    });
    // Invisible fill is filtered out; fills becomes empty array
    expect(ir[0]?.fills).toEqual([]);
  });
});

describe('withStubFallback resilience', () => {
  // Guards against the class of bug where a strict native/wasm deserializer
  // (Rust `IpcSceneNode`) rejects one node and the rejected Promise aborts the
  // whole frame, blanking the canvas. A native/wasm engine must degrade to the
  // pure-TS stub instead of throwing.
  function throwingEngine(backend: 'native' | 'wasm'): Engine {
    return {
      backend,
      buildIr: vi.fn(async () => {
        throw new Error('deserialize engine nodes: missing field `shape`');
      }),
      hitTest: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
  }

  it('buildIr falls back to the stub instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const eng = withStubFallback(throwingEngine('wasm'));
    const ir = await eng.buildIr(scene);
    // Stub produces one render item per node — proof the frame still paints.
    expect(ir).toHaveLength(scene.nodes.length);
    expect(ir[0]?.primitive).toEqual({ kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('latches to the stub after the first failure (circuit breaker) and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const primary = throwingEngine('native');
    const eng = withStubFallback(primary);
    await eng.buildIr(scene);
    await eng.buildIr(scene);
    await eng.buildIr(scene);
    // Primary is tried once, then the breaker keeps it off the hot path.
    expect(primary.buildIr).toHaveBeenCalledTimes(1);
    // A single warning per session, not one per frame.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('hitTest falls back to the stub without throwing', async () => {
    const eng = withStubFallback(throwingEngine('wasm'));
    // Point inside node 1's 10x10 rect at origin → topmost index resolves.
    const idx = await eng.hitTest(scene, [1, 1]);
    expect(idx).not.toBeNull();
  });

  it('routes raster tile scenes through the TS renderer', async () => {
    const primary: Engine = {
      backend: 'wasm',
      buildIr: vi.fn(async () => []),
      hitTest: vi.fn(async () => null),
    };
    const eng = withStubFallback(primary);
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'raster-1',
          name: 'Raster Layer',
          kind: 'rasterLayer',
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
          rasterLayerData: {
            width: 128,
            height: 128,
            pixelMode: false,
            tiles: { '0:0': { pixels: new Array(128 * 128 * 4).fill(0), version: 1 } },
          },
        },
      ],
    });

    expect(primary.buildIr).not.toHaveBeenCalled();
    expect(ir[0]?.primitive.kind).toBe('rasterLayer');
  });

  it('does not wrap a stub engine (no double fallback)', () => {
    const stub = createStubForTest();
    expect(withStubFallback(stub)).toBe(stub);
  });
});

// A minimal stub-backed engine to assert the no-wrap fast path.
function createStubForTest(): Engine {
  return {
    backend: 'stub',
    buildIr: async () => [],
    hitTest: async () => null,
  };
}
