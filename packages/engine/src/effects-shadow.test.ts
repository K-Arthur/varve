// @vitest-environment jsdom
/**
 * Alpha-aware shadows: regression coverage for contour-following drop and
 * inner shadows on transparent PNGs, background-removal masks, text glyphs,
 * and stroke-only primitives.
 *
 * These tests document that a shadow must follow the *rendered alpha
 * silhouette* of the item rather than its geometric bounding rectangle:
 *
 *  - Transparent PNG pixels (including internal holes and padding) must not
 *    be filled with a solid shadow-colored rectangle.
 *  - Text shadows must follow the glyph contours, not the text-box rect.
 *  - Stroke-only items (lines, arrows) must still cast a shadow.
 *  - Background-removal alpha masks must trim the casting silhouette.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getImageCache, resetImageCache } from './imageCache';
import type { ReplayTarget } from './replay';
import { replayIr } from './replay';
import type { FillIR, RenderItem } from './types';

interface RecorderProxy {
  target: ReplayTarget;
  calls: string[];
  props: Record<string, unknown>;
  drawImageArgs: unknown[][];
  alphaHistory: number[];
}

function recorder(): RecorderProxy {
  const calls: string[] = [];
  const props: Record<string, unknown> = {};
  const drawImageArgs: unknown[][] = [];
  const alphaHistory: number[] = [];
  const mk =
    (k: string) =>
    (...args: unknown[]) => {
      calls.push(`${k}(${args.length})`);
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
  tracked.globalAlpha = {
    get() {
      return 'globalAlpha' in props ? props.globalAlpha : 1;
    },
    set(v: unknown) {
      props.globalAlpha = v;
      alphaHistory.push(Number(v));
      calls.push('set globalAlpha');
    },
    configurable: true,
    enumerable: true,
  };
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

  const target: Record<string, unknown> = {
    save: mk('save'),
    restore: mk('restore'),
    transform: mk('transform'),
    translate: mk('translate'),
    rotate: mk('rotate'),
    scale: mk('scale'),
    fillRect: mk('fillRect'),
    strokeRect: mk('strokeRect'),
    beginPath: mk('beginPath'),
    rect: mk('rect'),
    clip: mk('clip'),
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
    drawImage: (...args: unknown[]) => {
      drawImageArgs.push(args);
      calls.push(`drawImage(${args.length})`);
    },
    createLinearGradient: mk('createLinearGradient'),
    createRadialGradient: mk('createRadialGradient'),
    createConicGradient: mk('createConicGradient'),
    createPattern: mk('createPattern'),
  };

  Object.entries(tracked).forEach(([k, desc]) => {
    Object.defineProperty(target, k, desc);
  });

  return { target: target as unknown as ReplayTarget, calls, props, drawImageArgs, alphaHistory };
}

function mockImage(src: string, w: number, h: number): HTMLImageElement {
  return {
    src,
    naturalWidth: w,
    naturalHeight: h,
    toString: () => src,
  } as unknown as HTMLImageElement;
}

/** A transparent-PNG-style image fill: alpha varies, holes may exist. */
function transparentPngFill(src: string, imageWidth: number, imageHeight: number): FillIR {
  return {
    type: 'image',
    src,
    fit: 'fill',
    x: 0,
    y: 0,
    scale: 1,
    imageWidth,
    imageHeight,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

function dropShadowEffect(overrides: Partial<Record<string, unknown>> = {}): RenderItem['effects'] {
  return [
    {
      type: 'dropShadow',
      x: 0,
      y: 4,
      blur: 8,
      spread: 0,
      color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
      opacity: 0.5,
      blendMode: 'normal',
      visible: true,
      ...overrides,
    },
  ];
}

const SHADOW_COLOR_RGBA = 'rgba(0, 0, 0, 0.502)';

beforeEach(() => {
  resetImageCache();
});

afterEach(() => {
  resetImageCache();
});

describe('alpha-aware drop shadow', () => {
  it('never fills the traced outline with the shadow color over a transparent image', () => {
    const rec = recorder();
    const src = 'data:image/png;base64,transparent';
    getImageCache().setLoaded(src, mockImage(src, 40, 40));

    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      fills: [transparentPngFill(src, 40, 40)],
      effects: dropShadowEffect(),
      primitive: { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
    };
    replayIr(rec.target, [item]);

    // The shadow must be cast from the image alpha via an offscreen buffer
    // drawn with the Canvas shadow API — never by re-filling the rect with
    // the shadow color (that would paint solid color over transparent holes).
    expect(rec.props.fillStyle).not.toBe(SHADOW_COLOR_RGBA);
    const solidOutlineFills = rec.calls.filter((c) => c.startsWith('fill(')).length;
    expect(solidOutlineFills).toBe(0);
    expect(rec.drawImageArgs.length).toBeGreaterThan(0);
    // shadow props must be enabled on the destination for the buffer draw
    expect(rec.calls).toContain('set shadowColor');
  });

  it('applies a background-removal alpha mask to the shadow silhouette', () => {
    const rec = recorder();
    const src = 'data:image/png;base64,subject';
    const mask = 'data:image/png;base64,mask';
    getImageCache().setLoaded(src, mockImage(src, 40, 40));
    getImageCache().setLoaded(mask, mockImage(mask, 40, 40));

    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      fills: [{ ...transparentPngFill(src, 40, 40), alphaMask: mask }] as FillIR[],
      effects: dropShadowEffect(),
      primitive: { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
    };
    replayIr(rec.target, [item]);

    // Masked subjects must not fall back to a solid outline fill either.
    expect(rec.props.fillStyle).not.toBe(SHADOW_COLOR_RGBA);
    expect(rec.calls.filter((c) => c.startsWith('fill(')).length).toBe(0);
    // The masked silhouette must be composited via drawImage.
    expect(rec.drawImageArgs.length).toBeGreaterThan(0);
  });

  it('casts a glyph-following shadow for text instead of a text-box rectangle', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: dropShadowEffect(),
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 120,
        h: 20,
        text: 'Hello',
        fontSize: 16,
        fontFamily: 'sans-serif',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.4,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
      },
    };
    replayIr(rec.target, [item]);

    // Text shadows must come from the glyph silhouette drawn to an offscreen
    // buffer (drawImage + shadow API), not from filling the text box.
    expect(rec.props.fillStyle).not.toBe(SHADOW_COLOR_RGBA);
    expect(rec.calls.filter((c) => c.startsWith('fill(')).length).toBe(0);
    expect(rec.drawImageArgs.length).toBeGreaterThan(0);
    expect(rec.calls).toContain('set shadowColor');
  });

  it('renders a shadow for a stroke-only line primitive', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 3,
          align: 'center',
          dashPattern: [],
          dashOffset: 0,
          cap: 'round',
          join: 'miter',
          miterLimit: 4,
          visible: true,
        },
      ],
      effects: dropShadowEffect(),
      primitive: { kind: 'line', from: [0, 0], to: [80, 0], tolerance: 4 },
    };
    replayIr(rec.target, [item]);

    // A stroke-only item must still cast a shadow (from its stroked
    // silhouette), and must not be left shadowless by a zero-area fill.
    expect(rec.props.fillStyle).not.toBe(SHADOW_COLOR_RGBA);
    expect(rec.calls.filter((c) => c.startsWith('fill(')).length).toBe(0);
    expect(rec.drawImageArgs.length).toBeGreaterThan(0);
    expect(rec.calls).toContain('set shadowColor');
  });

  it('applies item opacity to the shadow', () => {
    const rec = recorder();
    const src = 'data:image/png;base64,opacity';
    getImageCache().setLoaded(src, mockImage(src, 30, 30));

    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      opacity: 0.5,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      fills: [transparentPngFill(src, 30, 30)],
      effects: dropShadowEffect(),
      primitive: { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
    };
    replayIr(rec.target, [item]);

    // Shadow opacity = item opacity * effect opacity (0.5 * 0.5 = 0.25).
    // The alpha-aware pass must set globalAlpha to the combined opacity for
    // the shadow draw (the item's own fill is drawn at 0.5 via the fill pass).
    expect(rec.alphaHistory.some((a) => a >= 0.24 && a <= 0.26)).toBe(true);
    expect(rec.alphaHistory.some((a) => a >= 0.49 && a <= 0.51)).toBe(true);
  });

  it('degrades gracefully for malformed (NaN) effect parameters', () => {
    const rec = recorder();
    const src = 'data:image/png;base64,nan';
    getImageCache().setLoaded(src, mockImage(src, 30, 30));

    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      fills: [transparentPngFill(src, 30, 30)],
      effects: [
        {
          type: 'dropShadow',
          x: Number.NaN,
          y: Number.NaN,
          blur: Number.NaN,
          spread: Number.NaN,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
    };
    expect(() => replayIr(rec.target, [item])).not.toThrow();
    // NaN parameters must not produce a NaN fill/rect.
    expect(rec.drawImageArgs.length).toBeGreaterThan(0);
  });
});

describe('alpha-aware inner shadow', () => {
  it('does not fill transparent holes of an image with the shadow color', () => {
    const rec = recorder();
    const src = 'data:image/png;base64,inner';
    getImageCache().setLoaded(src, mockImage(src, 40, 40));

    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      fills: [transparentPngFill(src, 40, 40)],
      effects: [
        {
          type: 'innerShadow',
          x: 2,
          y: 2,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 40, h: 40 },
    };
    replayIr(rec.target, [item]);

    expect(rec.props.fillStyle).not.toBe(SHADOW_COLOR_RGBA);
    expect(rec.calls.filter((c) => c.startsWith('fill(')).length).toBe(0);
    // Inner shadow composites a pre-computed ring canvas, clipped to the shape.
    expect(rec.drawImageArgs.length).toBeGreaterThan(0);
    expect(rec.calls.some((c) => c.startsWith('clip('))).toBe(true);
  });
});
