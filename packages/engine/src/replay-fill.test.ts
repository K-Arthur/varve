import { describe, expect, it } from 'vitest';
import type { ReplayGradient, ReplayTarget } from './replay';
import { replayIr } from './replay';
import type { RenderItem, FillIR } from './types';

interface RecorderProxy {
  target: ReplayTarget;
  calls: string[];
  props: Record<string, unknown>;
}

function recorder(): RecorderProxy {
  const calls: string[] = [];
  const props: Record<string, unknown> = {};
  const mk =
    (k: string) =>
    (...args: unknown[]) => {
      const s = `${k}(${args.length})`;
      calls.push(s);
      return undefined;
    };

  const tracked: Record<string, PropertyDescriptor> = {};
  const defProp = (name: string, def: unknown) => {
    tracked[name] = {
      get() {
        return name in props ? props[name] : def;
      },
      set(v: unknown) {
        props[name] = v;
        calls.push(`set ${name}`);
      },
      configurable: true,
      enumerable: true,
    };
  };
  defProp('fillStyle', '');
  defProp('strokeStyle', '');
  defProp('lineWidth', 1);
  defProp('lineCap', 'butt');
  defProp('lineJoin', 'miter');
  defProp('globalAlpha', 1);
  defProp('globalCompositeOperation', 'source-over');
  defProp('filter', 'none');
  defProp('lineDashOffset', 0);
  defProp('shadowColor', 'transparent');
  defProp('shadowBlur', 0);
  defProp('shadowOffsetX', 0);
  defProp('shadowOffsetY', 0);
  defProp('font', '10px sans-serif');
  defProp('textAlign', 'left');
  defProp('textBaseline', 'alphabetic');

  let gradientId = 0;
  const gradients: Record<string, ReplayGradient> = {};

  const target: Record<string, unknown> = {
    save: mk('save'),
    restore: mk('restore'),
    transform: mk('transform'),
    fillRect: mk('fillRect'),
    strokeRect: mk('strokeRect'),
    beginPath: mk('beginPath'),
    ellipse: mk('ellipse'),
    arc: mk('arc'),
    moveTo: mk('moveTo'),
    lineTo: mk('lineTo'),
    bezierCurveTo: mk('bezierCurveTo'),
    fill: mk('fill'),
    stroke: mk('stroke'),
    closePath: mk('closePath'),
    setLineDash: mk('setLineDash'),
    roundRect: mk('roundRect'),
    fillText: mk('fillText'),

    createLinearGradient(x0: number, y0: number, x1: number, y1: number): ReplayGradient {
      const id = `lg${gradientId++}`;
      calls.push(`createLinearGradient(${[x0, y0, x1, y1].join(',')})`);
      const stops: { pos: number; col: string }[] = [];
      const g: ReplayGradient = {
        addColorStop(pos: number, col: string) {
          stops.push({ pos, col });
          calls.push(`addColorStop(${pos.toFixed(3)},${col})`);
        },
      };
      gradients[id] = g;
      return g;
    },

    createRadialGradient(
      x0: number,
      y0: number,
      r0: number,
      x1: number,
      y1: number,
      r1: number,
    ): ReplayGradient {
      const id = `rg${gradientId++}`;
      calls.push(`createRadialGradient(${[x0, y0, r0, x1, y1, r1].join(',')})`);
      const stops: { pos: number; col: string }[] = [];
      const g: ReplayGradient = {
        addColorStop(pos: number, col: string) {
          stops.push({ pos, col });
          calls.push(`addColorStop(${pos.toFixed(3)},${col})`);
        },
      };
      gradients[id] = g;
      return g;
    },

    createConicGradient(angle: number, cx: number, cy: number): ReplayGradient {
      const id = `cg${gradientId++}`;
      calls.push(`createConicGradient(${[angle, cx, cy].join(',')})`);
      const stops: { pos: number; col: string }[] = [];
      const g: ReplayGradient = {
        addColorStop(pos: number, col: string) {
          stops.push({ pos, col });
          calls.push(`addColorStop(${pos.toFixed(3)},${col})`);
        },
      };
      gradients[id] = g;
      return g;
    },
  };

  Object.entries(tracked).forEach(([k, desc]) => {
    Object.defineProperty(target, k, desc);
  });

  return { target: target as unknown as ReplayTarget, calls, props };
}

describe('gradient fill rendering', () => {
  it('renders linear gradient fill (createLinearGradient + addColorStop + fill)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: [255, 0, 0, 255] },
            { position: 1, color: [0, 0, 255, 255] },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('fillRect('))).toBe(true);
  });

  it('renders radial gradient fill (createRadialGradient + addColorStop)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'gradient',
          gradientType: 'radial',
          stops: [
            { position: 0, color: [255, 255, 255, 255] },
            { position: 1, color: [0, 0, 0, 255] },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createRadialGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
  });

  it('renders angular gradient via createConicGradient', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'gradient',
          gradientType: 'angular',
          stops: [
            { position: 0, color: [255, 0, 0, 255] },
            { position: 0.5, color: [0, 255, 0, 255] },
            { position: 1, color: [0, 0, 255, 255] },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createConicGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
  });

  it('renders diamond gradient as radial fallback', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'gradient',
          gradientType: 'diamond',
          stops: [
            { position: 0, color: [255, 255, 0, 255] },
            { position: 1, color: [0, 0, 0, 255] },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createRadialGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
  });

  it('gradient with zero stops returns transparent fallback', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(String(rec.props.fillStyle ?? '')).toBe('rgba(0,0,0,0)');
  });

  it('gradient rotation rotates the gradient axis', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: [0, 0, 0, 255] },
            { position: 1, color: [255, 255, 255, 255] },
          ],
          rotation: 90,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };
    const rec2 = recorder();
    replayIr(rec2.target, [item]);
    const lgCall = rec2.calls.find((c) => c.startsWith('createLinearGradient('));
    expect(lgCall).toBeTruthy();
  });

  it('invisible gradient fill is skipped', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: [255, 0, 0, 255] },
            { position: 1, color: [0, 0, 255, 255] },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient('))).toBe(false);
  });
});

describe('per-fill compositing', () => {
  it('per-fill opacity multiplies with item alpha', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      opacity: 0.5,
      fills: [
        {
          type: 'solid',
          color: [255, 0, 0, 255],
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    const alphaSets = rec.calls.filter((c) => c === 'set globalAlpha');
    expect(alphaSets.length).toBeGreaterThanOrEqual(1);
    expect(Number(rec.props.globalAlpha)).toBe(1);
  });

  it('per-fill blend mode is isolated from the next fill', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'solid',
          color: [255, 0, 0, 255],
          opacity: 1,
          blendMode: 'multiply',
          visible: true,
        },
        {
          type: 'solid',
          color: [0, 0, 255, 255],
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.props.globalCompositeOperation).toBe('source-over');
    const compCalls = rec.calls.filter((c) => c === 'set globalCompositeOperation');
    expect(compCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('per-fill visible=false fill is skipped in stack', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'solid',
          color: [0, 255, 0, 255],
          opacity: 1,
          blendMode: 'normal',
          visible: false,
        },
        {
          type: 'solid',
          color: [255, 0, 0, 255],
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    const fillStyleSets = rec.calls.filter((c) => c === 'set fillStyle');
    expect(fillStyleSets.length).toBe(1);
    expect(String(rec.props.fillStyle ?? '')).toContain('255, 0, 0');
  });
});

describe('blend mode mapping', () => {
  const modes: [string, string][] = [
    ['multiply', 'multiply'],
    ['screen', 'screen'],
    ['overlay', 'overlay'],
    ['darken', 'darken'],
    ['lighten', 'lighten'],
    ['colorDodge', 'color-dodge'],
    ['colorBurn', 'color-burn'],
    ['hardLight', 'hard-light'],
    ['softLight', 'soft-light'],
    ['difference', 'difference'],
    ['exclusion', 'exclusion'],
    ['hue', 'hue'],
    ['saturation', 'saturation'],
    ['color', 'color'],
    ['luminosity', 'luminosity'],
  ];

  for (const [mode, expected] of modes) {
    it(`maps ${mode} to ${expected}`, () => {
      const rec = recorder();
      const item: RenderItem = {
        transform: [1, 0, 0, 1, 0, 0],
        fill: [255, 0, 0, 255],
        blendMode: mode as RenderItem['blendMode'],
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      };
      replayIr(rec.target, [item]);
      expect(rec.props.globalCompositeOperation).toBe('source-over');
    });
  }

  it('blendMode=normal uses source-over', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [255, 0, 0, 255],
      blendMode: 'normal',
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    };
    const rec2 = recorder();
    replayIr(rec2.target, [item]);
    expect(rec2.props.globalCompositeOperation).toBe('source-over');
  });
});

describe('stroke rendering', () => {
  it('renders rect stroke via strokeRect', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [255, 255, 255, 255],
      strokes: [
        {
          color: [0, 0, 0, 255],
          weight: 2,
          cap: 'butt',
          join: 'miter',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set strokeStyle')).toBe(true);
    expect(rec.calls.some((c) => c === 'set lineWidth')).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('strokeRect('))).toBe(true);
  });

  it('rect stroke with cornerRadius uses roundRect path for stroke', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [255, 255, 255, 255],
      strokes: [
        {
          color: [0, 0, 0, 255],
          weight: 1,
          cap: 'butt',
          join: 'miter',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30, cornerRadius: 8 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('roundRect('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('strokeRect('))).toBe(false);
  });

  it('renders ellipse stroke via path', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [
        {
          color: [255, 0, 0, 255],
          weight: 3,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set strokeStyle')).toBe(true);
    expect(rec.calls.some((c) => c === 'set lineWidth')).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('ellipse('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('stroke('))).toBe(true);
  });

  it('stroke with dash pattern applies setLineDash', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [255, 255, 255, 255],
      strokes: [
        {
          color: [0, 0, 0, 255],
          weight: 1,
          cap: 'butt',
          join: 'miter',
          dashPattern: [5, 5],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('setLineDash('))).toBe(true);
  });

  it('invisible stroke is skipped', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [255, 255, 255, 255],
      strokes: [
        {
          color: [255, 0, 0, 255],
          weight: 5,
          cap: 'butt',
          join: 'miter',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set strokeStyle')).toBe(false);
  });

  it('line stroke matches from→to', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [
        {
          color: [0, 0, 0, 255],
          weight: 2,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'line', from: [0, 0], to: [100, 50], tolerance: 1 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('moveTo('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('lineTo('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('stroke('))).toBe(true);
  });
});

describe('effects rendering', () => {
  it('dropShadow sets shadow properties', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      effects: [
        {
          type: 'dropShadow',
          x: 2,
          y: 4,
          blur: 8,
          spread: 0,
          color: [0, 0, 0, 128],
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set shadowColor')).toBe(true);
    expect(rec.calls.some((c) => c === 'set shadowBlur')).toBe(true);
    expect(rec.calls.some((c) => c === 'set shadowOffsetX')).toBe(true);
    expect(rec.calls.some((c) => c === 'set shadowOffsetY')).toBe(true);
  });

  it('layerBlur sets filter', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      effects: [
        {
          type: 'layerBlur',
          radius: 4,
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set filter')).toBe(true);
    expect(String(rec.props.filter ?? '')).toContain('blur(4px)');
  });

  it('innerShadow is not rendered (documented as deferred)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      effects: [
        {
          type: 'innerShadow',
          x: 0,
          y: 2,
          blur: 4,
          spread: 0,
          color: [0, 0, 0, 128],
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set filter')).toBe(false);
    expect(rec.calls.some((c) => c === 'set shadowColor')).toBe(false);
  });

  it('backgroundBlur is not rendered (documented as deferred)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      effects: [
        {
          type: 'backgroundBlur',
          radius: 8,
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set filter')).toBe(false);
  });

  it('invisible effects are skipped', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      effects: [
        {
          type: 'dropShadow',
          x: 2,
          y: 4,
          blur: 8,
          spread: 0,
          color: [0, 0, 0, 128],
          opacity: 0.5,
          blendMode: 'normal',
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set shadowColor')).toBe(false);
  });

  it('multiple effects: dropShadow + layerBlur coexist', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      effects: [
        {
          type: 'dropShadow',
          x: 2,
          y: 4,
          blur: 6,
          spread: 0,
          color: [0, 0, 0, 128],
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'layerBlur',
          radius: 3,
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set shadowColor')).toBe(true);
    const filterSets = rec.calls.filter((c) => c === 'set filter');
    expect(filterSets.length).toBeGreaterThanOrEqual(2);
  });

  it('shadow/filter reset after each item', () => {
    const rec = recorder();
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: [0, 0, 0, 255],
        effects: [
          {
            type: 'dropShadow',
            x: 2,
            y: 4,
            blur: 8,
            spread: 0,
            color: [0, 0, 0, 128],
            opacity: 0.5,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: [0, 0, 0, 255],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
    ];
    replayIr(rec.target, items);
    expect(rec.props.shadowColor).toBe('transparent');
    expect(rec.props.shadowBlur).toBe(0);
    expect(rec.props.filter).toBe('none');
    const shadowSets = rec.calls.filter((c) => c === 'set shadowColor');
    expect(shadowSets.length).toBeGreaterThanOrEqual(2);
  });
});

describe('multi-item compositing edge cases', () => {
  it('multiple fills stack bottom→top with correct paint order', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      fills: [
        {
          type: 'solid',
          color: [255, 0, 0, 255],
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'solid',
          color: [0, 255, 0, 255],
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    const fillStyleSets = rec.calls.filter((c) => c === 'set fillStyle');
    expect(fillStyleSets.length).toBe(2);
    const lastFillStyle = String(rec.props.fillStyle ?? '');
    expect(lastFillStyle).toContain('0, 255, 0');
  });

  it('arrow does not double-draw arrowhead in fill+stroke', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      strokes: [
        {
          color: [255, 0, 0, 255],
          weight: 2,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'arrow', from: [0, 0], to: [100, 0], tolerance: 1, arrowheadSize: 10 },
    };
    replayIr(rec.target, [item]);
    const fillCalls = rec.calls.filter((c) => c === 'fill(0)');
    expect(fillCalls.length).toBe(1);
  });

  it('rgba() alpha precision uses raw division, not toFixed(3)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [57, 208, 198, 1],
      primitive: { kind: 'rect', x: 0, y: 0, w: 5, h: 6 },
    };
    replayIr(rec.target, [item]);
    const fs = String(rec.props.fillStyle ?? '');
    expect(fs).not.toBe('rgba(57, 208, 198, 0.004)');
    expect(fs).toBe('rgba(57, 208, 198, 0.00392156862745098)');
  });
});
