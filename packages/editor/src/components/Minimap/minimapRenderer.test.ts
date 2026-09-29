/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeMinimapTransform } from './minimapLayout';
import {
  type MinimapColors,
  renderMinimap,
  renderMinimapToCanvas,
  resolveMinimapColors,
} from './minimapRenderer';

function emptyScene() {
  return {
    entries: [],
    contentBounds: { x: 0, y: 0, w: 100, h: 100 },
    outliers: [],
    pages: [],
    totalNodes: 0,
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry',
    kind: 'shape' as const,
    paint: 'shape' as const,
    bounds: { x: 10, y: 10, w: 20, h: 20 },
    visible: true,
    locked: false,
    isFrame: false,
    isContainer: false,
    selected: false,
    name: 'Shape 1',
    labelWorthy: false,
    depth: 0,
    ...overrides,
  };
}

/**
 * A recording 2D context. `fillRect` pairs the resolved paint with the
 * composed alpha so a test can assert *what* was painted and *how strongly*,
 * which is where the contrast contract lives.
 */
function recordingContext() {
  let globalAlpha = 1;
  let fillStyle = '';
  let strokeStyle = '';
  let lineWidth = 1;
  let font = '';
  const stack: Array<{ globalAlpha: number; fillStyle: string; strokeStyle: string }> = [];
  const fills: Array<{ alpha: number; color: string; x: number; y: number; w: number; h: number }> =
    [];
  const strokes: Array<{ color: string; width: number }> = [];
  const texts: Array<{ text: string; font: string; color: string }> = [];
  const ellipses: Array<{ x: number; y: number; rx: number; ry: number }> = [];
  const pathPoints: Array<[number, number]> = [];
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn((x: number, y: number) => pathPoints.push([x, y])),
    lineTo: vi.fn((x: number, y: number) => pathPoints.push([x, y])),
    closePath: vi.fn(),
    fill: vi.fn(),
    ellipse: vi.fn((x: number, y: number, rx: number, ry: number) =>
      ellipses.push({ x, y, rx, ry }),
    ),
    stroke: vi.fn(() => strokes.push({ color: strokeStyle, width: lineWidth })),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) =>
      fills.push({ alpha: globalAlpha, color: fillStyle, x, y, w, h }),
    ),
    strokeRect: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    fillText: vi.fn((text: string) => texts.push({ text, font, color: fillStyle })),
    setLineDash: vi.fn(),
    save: vi.fn(() => stack.push({ globalAlpha, fillStyle, strokeStyle })),
    restore: vi.fn(() => {
      const previous = stack.pop();
      globalAlpha = previous?.globalAlpha ?? 1;
      fillStyle = previous?.fillStyle ?? '';
      strokeStyle = previous?.strokeStyle ?? '';
    }),
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(value: number) {
      globalAlpha = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(value: string) {
      strokeStyle = value;
    },
    get lineWidth() {
      return lineWidth;
    },
    set lineWidth(value: number) {
      lineWidth = value;
    },
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
  } as unknown as CanvasRenderingContext2D;
  return { context, fills, strokes, texts, ellipses, pathPoints };
}

describe('minimapRenderer', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
  });

  it('keeps CSS color tokens intact instead of parsing them as hex', () => {
    const colors = resolveMinimapColors((name, fallback) =>
      name === '--color-canvas-selection' ? 'rgb(0 208 198)' : fallback,
    );

    expect(colors.viewfinderStroke).toBe('rgb(0 208 198)');
    expect(colors.selectionStroke).toBe('rgb(0 208 198)');
  });

  it('keeps the viewfinder distinguishable from a selected object', () => {
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    // The viewfinder's accent core and a selected object's outline are both
    // `canvas-selection` — and `canvas-selection` is identical to
    // `interactive-default` in every theme — so colour alone could never
    // separate "the camera rectangle" from "the selected object". The
    // viewfinder therefore carries a second band in the theme's strongest
    // surface contrast, which is what makes it a different mark.
    expect(colors.viewfinderStroke).toBe(colors.selectionStroke);
    expect(colors.viewfinderRing).not.toBe(colors.viewfinderStroke);
  });

  it('reads overview ink from the audited minimap tokens, never border-subtle', () => {
    const requested: string[] = [];
    const colors = resolveMinimapColors((name, fallback) => {
      requested.push(name);
      return fallback;
    });
    const values = Object.values(colors) as string[];

    for (const size of ['shape', 'text', 'image', 'adjustment', 'frame']) {
      expect(requested).toContain(`--color-minimap-ink-${size}`);
    }
    expect(requested).toContain('--color-surface-sunken');
    // Regression guard: shape/text/group ink used border-subtle, which
    // measures 1.19:1 on the map backplate in Light — invisible artwork.
    expect(values).not.toContain('--color-border-subtle');
    expect(requested).not.toContain('--color-border-subtle');
  });

  it('paints each leaf kind with its own ink under one flat pass', () => {
    const { context, fills } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 160, 120);

    renderMinimap(
      context,
      {
        ...emptyScene(),
        entries: [
          entry({ id: 'frame', paint: 'frame', kind: 'frame', isFrame: true }),
          entry({ id: 'text', paint: 'text', kind: 'text' }),
          entry({ id: 'image', paint: 'image', kind: 'shape' }),
          entry({ id: 'shape', paint: 'shape' }),
          entry({ id: 'adjustment', paint: 'adjustment', kind: 'adjustment' }),
        ],
      },
      transform,
      null,
      colors,
    );

    const palette = fills.map((fill) => fill.color);
    expect(palette).toContain(colors.frameInk);
    expect(palette).toContain(colors.textInk);
    expect(palette).toContain(colors.imageInk);
    expect(palette).toContain(colors.shapeInk);
    expect(palette).toContain(colors.adjustmentInk);
  });

  it('does not paint group outlines, so no edge is drawn twice', () => {
    const { context, fills, strokes } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 160, 120);

    renderMinimap(
      context,
      { ...emptyScene(), entries: [entry({ id: 'g', paint: 'group', kind: 'group' })] },
      transform,
      null,
      colors,
    );

    expect(fills).toHaveLength(1); // backplate only
    expect(strokes).toHaveLength(0);
  });

  it('draws an ellipse as a silhouette instead of its bounding box', () => {
    const { context, fills, ellipses } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 160, 120);

    renderMinimap(
      context,
      { ...emptyScene(), entries: [entry({ id: 'c', paint: 'ellipse', kind: 'shape' })] },
      transform,
      null,
      colors,
    );

    expect(ellipses).toHaveLength(1);
    expect(ellipses[0]!.rx).toBeGreaterThan(0);
    expect(ellipses[0]!.ry).toBeGreaterThan(0);
    // The only rectangular fill is the backplate: no box for the circle.
    expect(fills).toHaveLength(1);
  });

  it('keeps hidden-node ghosts deliberately sub-floor', () => {
    const { context, fills } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 160, 120);

    renderMinimap(
      context,
      { ...emptyScene(), entries: [entry({ visible: false })] },
      transform,
      null,
      colors,
    );

    const ghost = fills.find((fill) => fill.color === colors.hiddenInk);
    expect(ghost?.alpha).toBeCloseTo(0.15, 5);
    expect(fills.find((fill) => fill.color === colors.shapeInk)).toBeUndefined();
  });

  it('omits a label that cannot reach the legibility floor', () => {
    const { context, texts } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 1000, h: 1000 }, 160, 120);

    renderMinimap(
      context,
      {
        ...emptyScene(),
        entries: [
          entry({
            id: 'f',
            paint: 'frame',
            kind: 'frame',
            isFrame: true,
            name: 'Tiny frame',
            labelWorthy: true,
            bounds: { x: 0, y: 0, w: 40, h: 40 },
          }),
        ],
      },
      transform,
      null,
      colors,
    );

    // 40 world units inside a 1000-unit document is a few CSS px tall: below
    // LABEL_MIN_PX, so the name is dropped rather than rendered as mush.
    expect(texts).toHaveLength(0);
  });

  it('draws a legible label for a large labelled frame', () => {
    const { context, texts } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 300, h: 200 }, 160, 120);

    renderMinimap(
      context,
      {
        ...emptyScene(),
        entries: [
          entry({
            id: 'f',
            paint: 'frame',
            kind: 'frame',
            isFrame: true,
            name: 'Hero',
            labelWorthy: true,
            bounds: { x: 0, y: 0, w: 300, h: 200 },
          }),
        ],
      },
      transform,
      null,
      colors,
      { labelFont: 'Inter, sans-serif' },
    );

    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toBe('Hero');
    expect(texts[0]!.font).toContain('Inter');
    const size = Number.parseFloat(texts[0]!.font);
    expect(size).toBeGreaterThanOrEqual(7);
    expect(size).toBeLessThanOrEqual(10);
  });

  it('never renders an auto-generated name', () => {
    const { context, texts } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 300, h: 200 }, 160, 120);

    renderMinimap(
      context,
      {
        ...emptyScene(),
        entries: [
          entry({
            id: 'f',
            paint: 'frame',
            kind: 'frame',
            isFrame: true,
            name: 'Frame 4',
            labelWorthy: false,
            bounds: { x: 0, y: 0, w: 300, h: 200 },
          }),
        ],
      },
      transform,
      null,
      colors,
    );

    expect(texts).toHaveLength(0);
  });

  it('draws the viewport rectangle with a contrast ring under the accent outline', () => {
    const { context, strokes } = recordingContext();
    const colors: MinimapColors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 160, 120);
    const footprint = {
      points: [
        [10, 10],
        [30, 10],
        [30, 30],
        [10, 30],
      ] as Array<[number, number]>,
      bounds: { x: 10, y: 10, w: 20, h: 20 },
    };

    renderMinimap(context, emptyScene(), transform, footprint, colors);

    const ring = strokes.find((stroke) => stroke.color === colors.viewfinderRing);
    const outline = strokes.find((stroke) => stroke.color === colors.viewfinderStroke);
    expect(ring).toBeDefined();
    expect(outline).toBeDefined();
    // Ring first (wider), accent on top (narrower).
    expect(strokes.indexOf(ring!)).toBeLessThan(strokes.indexOf(outline!));
    expect(ring!.width).toBeGreaterThan(outline!.width);
  });

  it('strengthens the viewport outline while dragging and leaves the document pass untouched', () => {
    const idle = recordingContext();
    const drag = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 160, 120);
    const footprint = {
      points: [
        [10, 10],
        [30, 10],
        [30, 30],
        [10, 30],
      ] as Array<[number, number]>,
      bounds: { x: 10, y: 10, w: 20, h: 20 },
    };

    renderMinimap(idle.context, emptyScene(), transform, footprint, colors, {
      viewfinder: 'idle',
    });
    renderMinimap(drag.context, emptyScene(), transform, footprint, colors, {
      viewfinder: 'drag',
    });

    const idleOutline = idle.strokes.filter(
      (stroke) => stroke.color === colors.viewfinderStroke,
    )[0]!;
    const dragOutline = drag.strokes.filter(
      (stroke) => stroke.color === colors.viewfinderStroke,
    )[0]!;
    expect(dragOutline.width).toBeGreaterThan(idleOutline.width);
    // The document pass is identical: interaction state must not repaint it.
    expect(drag.fills).toEqual(idle.fills);
  });

  it('grows a sub-pixel viewport rectangle to a grabbable minimum', () => {
    const { context, strokes } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 10000, h: 10000 }, 160, 120);
    const tiny = {
      points: [
        [80, 60],
        [80.2, 60],
        [80.2, 60.2],
        [80, 60.2],
      ] as Array<[number, number]>,
      bounds: { x: 80, y: 60, w: 0.2, h: 0.2 },
    };

    renderMinimap(context, emptyScene(), transform, tiny, colors);

    const hasOutline = strokes.some((stroke) => stroke.color === colors.viewfinderStroke);
    expect(hasOutline).toBe(true);
  });

  it('never draws the viewport rectangle outside the map stage', () => {
    // While panning near a document's edge the true projected rectangle runs
    // off the map, and its surviving half renders as two bare lines through
    // the artwork rather than a recognisable viewfinder.
    const { context, pathPoints } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 160, 120);
    const overhanging = {
      points: [
        [-40, -30],
        [200, -30],
        [200, 90],
        [-40, 90],
      ] as Array<[number, number]>,
      bounds: { x: -40, y: -30, w: 240, h: 120 },
    };

    renderMinimap(context, emptyScene(), transform, overhanging, colors);

    expect(pathPoints.length).toBeGreaterThan(0);
    for (const [x, y] of pathPoints) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(transform.mmWidth);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(transform.mmHeight);
    }
  });

  it('points at the viewport instead of drawing nothing when it leaves the map', () => {
    const { context, pathPoints, strokes } = recordingContext();
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform({ x: 0, y: 0, w: 100, h: 100 }, 160, 120);
    const offStage = {
      points: [
        [400, 400],
        [460, 400],
        [460, 440],
        [400, 440],
      ] as Array<[number, number]>,
      bounds: { x: 400, y: 400, w: 60, h: 40 },
    };

    renderMinimap(context, emptyScene(), transform, offStage, colors);

    // A chevron: three points forming two segments, stroked in the viewfinder
    // accent, with no interior wash at all.
    expect(pathPoints).toHaveLength(3);
    expect(strokes.some((stroke) => stroke.color === colors.viewfinderStroke)).toBe(true);
    for (const [x, y] of pathPoints) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(transform.mmWidth);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(transform.mmHeight);
    }
  });

  it('does not reallocate the backing store when only the camera projection redraws', () => {
    const canvas = document.createElement('canvas');
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: vi.fn(() => context),
    });
    let width = 0;
    let height = 0;
    let widthAssignments = 0;
    let heightAssignments = 0;
    Object.defineProperties(canvas, {
      width: {
        configurable: true,
        get: () => width,
        set: (value: number) => {
          widthAssignments += 1;
          width = value;
        },
      },
      height: {
        configurable: true,
        get: () => height,
        set: (value: number) => {
          heightAssignments += 1;
          height = value;
        },
      },
    });
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const transform = computeMinimapTransform(emptyScene().contentBounds, 160, 120);

    renderMinimapToCanvas(canvas, emptyScene(), transform, null, colors);
    renderMinimapToCanvas(canvas, emptyScene(), transform, null, colors);

    expect(width).toBe(320);
    expect(height).toBe(240);
    expect(widthAssignments).toBe(1);
    expect(heightAssignments).toBe(1);
    // Each redraw copies the cached document layer 1:1, then draws the
    // viewport indicator at the device pixel ratio.
    expect(vi.mocked(context.setTransform).mock.calls).toEqual([
      [1, 0, 0, 1, 0, 0],
      [2, 0, 0, 2, 0, 0],
      [1, 0, 0, 1, 0, 0],
      [2, 0, 0, 2, 0, 0],
    ]);
  });

  it('redraws only the viewport indicator when the camera alone changes', () => {
    const canvas = document.createElement('canvas');
    const main = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    };
    Object.defineProperty(canvas, 'getContext', { configurable: true, value: () => main });
    const layerContext = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn() };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = createElement(tag);
      if (tag === 'canvas') {
        Object.defineProperty(element, 'getContext', {
          configurable: true,
          value: () => layerContext,
        });
      }
      return element;
    }) as typeof document.createElement);
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const scene = emptyScene();
    const transform = computeMinimapTransform(scene.contentBounds, 160, 120);
    const footprint = (x: number) => ({
      points: [
        [x, 10],
        [x + 20, 10],
        [x + 20, 30],
        [x, 30],
      ] as Array<[number, number]>,
      bounds: { x, y: 10, w: 20, h: 20 },
    });

    renderMinimapToCanvas(canvas, scene, transform, footprint(10) as never, colors);
    renderMinimapToCanvas(canvas, scene, transform, footprint(40) as never, colors);

    // The document layer is rendered exactly once for two camera moves...
    expect(layerContext.fillRect).toHaveBeenCalledTimes(1);
    // ...and both frames copy it and re-stroke only the indicator.
    expect(main.drawImage).toHaveBeenCalledTimes(2);
    expect(main.stroke).toHaveBeenCalledTimes(4);
    vi.restoreAllMocks();
  });

  it('does not invalidate the document layer when the viewfinder state changes', () => {
    const canvas = document.createElement('canvas');
    const main = {
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    };
    Object.defineProperty(canvas, 'getContext', { configurable: true, value: () => main });
    const layerContext = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn() };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = createElement(tag);
      if (tag === 'canvas') {
        Object.defineProperty(element, 'getContext', {
          configurable: true,
          value: () => layerContext,
        });
      }
      return element;
    }) as typeof document.createElement);
    const colors = resolveMinimapColors((_name, fallback) => fallback);
    const scene = emptyScene();
    const transform = computeMinimapTransform(scene.contentBounds, 160, 120);
    const footprint = {
      points: [
        [10, 10],
        [30, 10],
        [30, 30],
        [10, 30],
      ] as Array<[number, number]>,
      bounds: { x: 10, y: 10, w: 20, h: 20 },
    };

    renderMinimapToCanvas(canvas, scene, transform, footprint as never, colors, {
      viewfinder: 'idle',
    });
    renderMinimapToCanvas(canvas, scene, transform, footprint as never, colors, {
      viewfinder: 'hover',
    });

    // Hovering must not walk the document again.
    expect(layerContext.fillRect).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
