/**
 * Tests for replayIr — particularly the text rendering case not covered by
 * the existing engine.test.ts (which tests the stub engine, not replayIr).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReplayTarget } from './replay';
import { drawClusters, primitiveBounds, replayIr } from './replay';
import type { RenderItem } from './types';

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
    (...args: unknown[]) =>
      calls.push(`${k}(${args.length})`);
  const target: Record<string, unknown> = {
    save: mk('save'),
    restore: mk('restore'),
    clip: mk('clip'),
    transform: mk('transform'),
    translate: mk('translate'),
    rotate: mk('rotate'),
    scale: mk('scale'),
    fillRect: mk('fillRect'),
    strokeRect: mk('strokeRect'),
    beginPath: mk('beginPath'),
    rect: mk('rect'),
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

    get fillStyle() {
      return (props.fillStyle as string) ?? '';
    },
    set fillStyle(v) {
      props.fillStyle = v;
      calls.push('set fillStyle');
    },
    get lineWidth() {
      return (props.lineWidth as number) ?? 0;
    },
    set lineWidth(v) {
      props.lineWidth = v;
      calls.push('set lineWidth');
    },
    get lineCap() {
      return (props.lineCap as CanvasLineCap) ?? 'butt';
    },
    set lineCap(v) {
      props.lineCap = v;
      calls.push('set lineCap');
    },
    get strokeStyle() {
      return (props.strokeStyle as string) ?? '';
    },
    set strokeStyle(v) {
      props.strokeStyle = v;
      calls.push('set strokeStyle');
    },
    get lineJoin() {
      return (props.lineJoin as CanvasLineJoin) ?? 'miter';
    },
    set lineJoin(v) {
      props.lineJoin = v;
      calls.push('set lineJoin');
    },
    get globalAlpha() {
      return (props.globalAlpha as number) ?? 1;
    },
    set globalAlpha(v) {
      props.globalAlpha = v;
      calls.push('set globalAlpha');
    },
    get globalCompositeOperation() {
      return (props.globalCompositeOperation as string) ?? 'source-over';
    },
    set globalCompositeOperation(v) {
      props.globalCompositeOperation = v;
      calls.push('set globalCompositeOperation');
    },
    get filter() {
      return (props.filter as string) ?? 'none';
    },
    set filter(v) {
      props.filter = v;
      calls.push('set filter');
    },
    get lineDashOffset() {
      return (props.lineDashOffset as number) ?? 0;
    },
    set lineDashOffset(v) {
      props.lineDashOffset = v;
      calls.push('set lineDashOffset');
    },
    get shadowColor() {
      return (props.shadowColor as string) ?? 'transparent';
    },
    set shadowColor(v) {
      props.shadowColor = v;
      calls.push('set shadowColor');
    },
    get shadowBlur() {
      return (props.shadowBlur as number) ?? 0;
    },
    set shadowBlur(v) {
      props.shadowBlur = v;
      calls.push('set shadowBlur');
    },
    get shadowOffsetX() {
      return (props.shadowOffsetX as number) ?? 0;
    },
    set shadowOffsetX(v) {
      props.shadowOffsetX = v;
      calls.push('set shadowOffsetX');
    },
    get shadowOffsetY() {
      return (props.shadowOffsetY as number) ?? 0;
    },
    set shadowOffsetY(v) {
      props.shadowOffsetY = v;
      calls.push('set shadowOffsetY');
    },
    get font() {
      return (props.font as string) ?? '10px sans-serif';
    },
    set font(v) {
      props.font = v;
      calls.push('set font');
    },
    get textAlign() {
      return (props.textAlign as CanvasTextAlign) ?? 'left';
    },
    set textAlign(v) {
      props.textAlign = v;
      calls.push('set textAlign');
    },
    get textBaseline() {
      return (props.textBaseline as string) ?? 'alphabetic';
    },
    set textBaseline(v) {
      props.textBaseline = v;
      calls.push('set textBaseline');
    },
  };
  return { target: target as unknown as ReplayTarget, calls, props };
}

/** Class-based recorder for text-focused tests — tracks actual values. */
class Recorder implements ReplayTarget {
  public calls: string[] = [];
  save() {
    this.calls.push('save');
  }
  restore() {
    this.calls.push('restore');
  }
  clip() {
    this.calls.push('clip');
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.calls.push(`transform(${a},${b},${c},${d},${e},${f})`);
  }
  translate(x: number, y: number) {
    this.calls.push(`translate(${x},${y})`);
  }
  rotate(angle: number) {
    this.calls.push(`rotate(${angle})`);
  }
  scale(x: number, y: number) {
    this.calls.push(`scale(${x},${y})`);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`fillRect(${x},${y},${w},${h})`);
  }
  beginPath() {
    this.calls.push('beginPath');
  }
  rect(x: number, y: number, w: number, h: number) {
    this.calls.push(`rect(${x},${y},${w},${h})`);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number) {
    this.calls.push(`ellipse(${x},${y},${rx},${ry},${rot},${start},${end})`);
  }
  arc(x: number, y: number, r: number, start: number, end: number) {
    this.calls.push(`arc(${x},${y},${r},${start},${end})`);
  }
  moveTo(x: number, y: number) {
    this.calls.push(`moveTo(${x},${y})`);
  }
  lineTo(x: number, y: number) {
    this.calls.push(`lineTo(${x},${y})`);
  }
  fill() {
    this.calls.push('fill');
  }
  stroke() {
    this.calls.push('stroke');
  }
  closePath() {
    this.calls.push('closePath');
  }
  fillStyle: string = '';
  lineWidth: number = 1;
  lineCap: CanvasLineCap = 'round';
  font: string = '';
  textAlign: CanvasTextAlign = 'left';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  fillText(text: string, x: number, y: number) {
    this.calls.push(`fillText("${text}",${x},${y})`);
  }
  // Stubs for required ReplayTarget members
  strokeRect() {}
  bezierCurveTo() {}
  setLineDash() {}
  roundRect() {}
  lineJoin: CanvasLineJoin = 'miter';
  strokeStyle: string = '';
  globalAlpha: number = 1;
  globalCompositeOperation: string = 'source-over';
  filter: string = 'none';
  lineDashOffset: number = 0;
  shadowColor: string = 'transparent';
  shadowBlur: number = 0;
  shadowOffsetX: number = 0;
  shadowOffsetY: number = 0;
}

class MeasuredRecorder extends Recorder {
  measureText(text: string): TextMetrics {
    return { width: text.length * 10 } as TextMetrics;
  }
}

describe('drawClusters (kerning-off and glyph adjustments)', () => {
  const basePrimitive: Extract<RenderItem['primitive'], { kind: 'text' }> = {
    kind: 'text',
    text: 'ABC',
    fontSize: 16,
    fontFamily: 'Inter',
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
    x: 0,
    y: 0,
    w: 100,
    h: 20,
  };

  function recorderTarget(): Recorder {
    const rec = new Recorder();
    rec.textBaseline = 'top';
    rec.textAlign = 'left';
    rec.font = '400 16px "Inter"';
    return rec;
  }

  it('draws one fillText per cluster (kerning off between clusters)', () => {
    const rec = recorderTarget();
    drawClusters(rec, 'ABC', 0, 0, 0, 0, basePrimitive, () => 10);
    expect(rec.calls.filter((c) => c.startsWith('fillText'))).toEqual([
      'fillText("A",0,0)',
      'fillText("B",10,0)',
      'fillText("C",20,0)',
    ]);
    expect(rec.calls).not.toContain('fillText("ABC",0,0)');
  });

  it('applies pair adjustments to the following cluster advance', () => {
    const rec = recorderTarget();
    drawClusters(rec, 'ABC', 0, 0, 0, 0, { ...basePrimitive, pairAdjustments: { 0: 5 } }, () => 10);
    expect(rec.calls).toContain('fillText("A",0,0)');
    expect(rec.calls).toContain('fillText("B",15,0)');
    expect(rec.calls).toContain('fillText("C",25,0)');
  });

  it('applies glyph offset via translate and draws at local origin', () => {
    const rec = recorderTarget();
    drawClusters(
      rec,
      'AB',
      0,
      0,
      0,
      0,
      {
        ...basePrimitive,
        glyphAdjustments: { 1: { dx: 3, dy: -2, advance: 0, rotation: 0, scaleX: 1, scaleY: 1 } },
      },
      () => 10,
    );
    expect(rec.calls).toContain('translate(13,-2)');
    expect(rec.calls).toContain('fillText("B",0,0)');
  });

  it('applies rotation and scale transforms', () => {
    const rec = recorderTarget();
    drawClusters(
      rec,
      'AB',
      0,
      0,
      0,
      0,
      {
        ...basePrimitive,
        glyphAdjustments: {
          0: { dx: 0, dy: 0, advance: 0, rotation: 0.5, scaleX: 1.5, scaleY: 1 },
        },
      },
      () => 10,
    );
    expect(rec.calls).toContain('translate(0,0)');
    expect(rec.calls).toContain('rotate(0.5)');
    expect(rec.calls).toContain('scale(1.5,1)');
  });

  it('advance override shifts following clusters', () => {
    const rec = recorderTarget();
    drawClusters(
      rec,
      'ABC',
      0,
      0,
      0,
      0,
      {
        ...basePrimitive,
        glyphAdjustments: { 0: { dx: 0, dy: 0, advance: 7, rotation: 0, scaleX: 1, scaleY: 1 } },
      },
      () => 10,
    );
    expect(rec.calls).toContain('fillText("B",17,0)');
  });

  it('adds letterSpacing and tracking to every cluster advance', () => {
    const rec = recorderTarget();
    drawClusters(rec, 'AB', 0, 0, 2, 1, basePrimitive, () => 10);
    expect(rec.calls).toContain('fillText("B",13,0)');
  });
});

describe('primitiveBounds', () => {
  it('includes path anchors, Bézier handles, and hole rings', () => {
    const bounds = primitiveBounds({
      kind: 'path',
      points: [
        { x: 10, y: 20, handleIn: null, handleOut: [-30, 5] },
        { x: 50, y: 60, handleIn: [40, -80], handleOut: null },
      ],
      holes: [
        [
          { x: -100, y: 200, handleIn: null, handleOut: [-10, 30] },
          { x: -80, y: 210, handleIn: null, handleOut: null },
        ],
      ],
      closed: true,
      tolerance: 1,
      fillRule: 'evenodd',
    });

    expect(bounds).toEqual({ x: -110, y: -20, w: 200, h: 250 });
  });

  it('returns finite zero bounds for an empty path', () => {
    expect(primitiveBounds({ kind: 'path', points: [], closed: false, tolerance: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  });

  it('ignores non-finite path coordinates and handles', () => {
    const bounds = primitiveBounds({
      kind: 'path',
      points: [
        { x: Number.NaN, y: 10, handleIn: null, handleOut: null },
        { x: 20, y: 30, handleIn: [Number.POSITIVE_INFINITY, 0], handleOut: [-5, 10] },
      ],
      closed: false,
      tolerance: 1,
    });

    expect(bounds).toEqual({ x: 15, y: 30, w: 5, h: 10 });
    expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
  });
});

describe('replayIr', () => {
  it('restores canvas state when painting an item throws', () => {
    const rec = recorder();
    let restoreCount = 0;
    rec.target.restore = () => {
      restoreCount++;
    };
    rec.target.fillRect = () => {
      throw new Error('paint failed');
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    };

    expect(() => replayIr(rec.target, [item])).toThrow('paint failed');
    expect(restoreCount).toBe(1);
  });

  it('replays a rect: save, transform, fillStyle, fillRect, restore', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 10, 20],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 5, h: 6 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    // Core visual calls. Property resets (shadow, filter, alpha, blend)
    // appear between fillRect and restore.
    const idxFillRect = rec.calls.indexOf('fillRect(4)');
    const idxRestore = rec.calls.indexOf('restore(0)');
    expect(idxFillRect).toBeGreaterThan(0);
    expect(idxRestore).toBeGreaterThan(idxFillRect);
    expect(rec.props.fillStyle).toBe('rgba(57, 208, 198, 1)');
  });

  it('replays an ellipse via beginPath + ellipse + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      primitive: { kind: 'ellipse', cx: 1, cy: 2, rx: 3, ry: 4 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('ellipse(7)');
    expect(rec.calls).toContain('fill(0)');
  });

  it('renders text primitive with correct font settings', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 10, 20] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Hello',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    expect(rec.font).toContain('400');
    expect(rec.font).toContain('16px');
    expect(rec.font).toContain('"Inter"');
    expect(rec.textAlign).toBe('left');
    expect(rec.textBaseline).toBe('top');
    expect(rec.calls).toContain('fillText("Hello",0,0)');
    expect(rec.calls).toContain('save');
    expect(rec.calls).toContain('restore');
  });

  it('renders italic text with correct font prefix', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Italic',
          fontSize: 20,
          fontFamily: 'Serif',
          fontWeight: 700,
          fontStyle: 'italic' as const,
          textAlign: 'center' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    expect(rec.font).toMatch(/^italic /);
  });

  it('renders kerning-off text as one fillText per cluster via replayIr', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'TO',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
          kerningMode: 'none',
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    expect(rec.calls).not.toContain('fillText("TO",0,0)');
    expect(rec.calls.some((c) => c.startsWith('fillText("T"'))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('fillText("O"'))).toBe(true);
  });

  it('handles empty string text gracefully', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: '',
          fontSize: 12,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec2 = new Recorder();
    expect(() => replayIr(rec2, items)).not.toThrow();
    expect(rec2.calls).toContain('fillText("",0,0)');
  });

  it('replays a line as a stroked segment with tolerance width', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: { kind: 'line', from: [0, 0], to: [10, 0], tolerance: 2 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('moveTo(2)');
    expect(rec.calls).toContain('lineTo(2)');
    expect(rec.calls).toContain('stroke(0)');
    expect(rec.props.lineWidth).toBe(2);
    expect(rec.props.lineCap).toBe('round');
  });

  it('applies item opacity via globalAlpha', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      opacity: 0.5,
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    // opacity=0.5 → set globalAlpha=0.5 during paint, then reset to 1.
    // The calls array contains at least one 'set globalAlpha'.
    const alphaCalls = rec.calls.filter((c) => c === 'set globalAlpha');
    expect(alphaCalls.length).toBeGreaterThanOrEqual(1);
    // The recorded value after paint+reset should be 1.
    expect(rec.props.globalAlpha).toBe(1);
  });

  it('applies blend mode via globalCompositeOperation', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      blendMode: 'multiply',
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    const blendCalls = rec.calls.filter((c) => c === 'set globalCompositeOperation');
    expect(blendCalls.length).toBeGreaterThanOrEqual(1);
    expect(rec.props.globalCompositeOperation).toBe('source-over');
  });

  it('resets alpha/blend/shadow after each item', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 0.5,
        blendMode: 'screen',
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      },
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      },
    ];
    const rec = recorder();
    replayIr(rec.target, items);
    expect(rec.props.globalAlpha).toBe(1);
    expect(rec.props.globalCompositeOperation).toBe('source-over');
    // Two items → two paint cycles → shadow/filter/alpha/blend resets twice each.
    const alphaSets = rec.calls.filter((c) => c === 'set globalAlpha');
    expect(alphaSets.length).toBeGreaterThanOrEqual(2);
  });

  it('handles an empty IR', () => {
    const rec = recorder();
    replayIr(rec.target, []);
    expect(rec.calls).toEqual([]);
  });

  it('clamps fontWeight to valid CSS range', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'test',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 9999,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec3 = new Recorder();
    replayIr(rec3, items);
    // Clamped to 1000
    expect(rec3.font).toContain('1000');
  });

  it('renders rich text with per-run formatting', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          x: 0,
          y: 0,
          w: 200,
          h: 100,
          text: 'Hello World',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          richText: {
            paragraphs: [
              {
                runs: [
                  { text: 'Hello', format: { fontWeight: 400 } },
                  { text: ' World', format: { fontWeight: 700, fontSize: 20 } },
                ],
              },
            ],
          },
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    const fillTextCalls = rec.calls.filter((c) => c.startsWith('fillText('));
    expect(fillTextCalls.some((c) => c.includes('Hello'))).toBe(true);
    expect(fillTextCalls.some((c) => c.includes('World'))).toBe(true);
  });

  it('uses the canonical snapshot for measured rich spans', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 200,
        h: 40,
        text: 'AB',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.2,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        richText: {
          paragraphs: [
            {
              runs: [
                { text: 'A', format: { fontFamily: 'Inter', fontSize: 12, fontWeight: 400 } },
                { text: 'B', format: { fontFamily: 'Inter', fontSize: 24, fontWeight: 700 } },
              ],
            },
          ],
        },
      },
    };
    const rec = new MeasuredRecorder();
    replayIr(rec, [item]);
    expect(rec.calls).toContain('fillText("A",0,19.200000000000003)');
    expect(rec.calls).toContain('fillText("B",10,19.200000000000003)');
    expect(rec.calls).not.toContain('fillText("AB",0,0)');
  });

  it('does not wrap rich point text at its content width', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        // Smaller than the source on purpose. Point text must ignore this as
        // a wrapping constraint; it is a content-grown selection width.
        w: 10,
        h: 100,
        text: 'ABCD',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.2,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        textMode: 'point',
        richText: { paragraphs: [{ runs: [{ text: 'ABCD' }] }] },
      },
    };

    const rec = new MeasuredRecorder();
    replayIr(rec, [item]);
    const textCalls = rec.calls.filter((call) => call.startsWith('fillText('));
    expect(textCalls).toHaveLength(4);
    expect(new Set(textCalls.map((call) => call.split(',').at(-1))).size).toBe(1);

    // The browser-less fallback uses the same no-wrap sentinel. A point
    // paragraph containing breakable words must stay one line there too.
    const fallbackItem: RenderItem = {
      ...item,
      primitive: {
        ...item.primitive,
        text: 'A B C D',
        richText: { paragraphs: [{ runs: [{ text: 'A B C D' }] }] },
      },
    };
    const fallback = new Recorder();
    replayIr(fallback, [fallbackItem]);
    const fallbackTextCalls = fallback.calls.filter((call) => call.startsWith('fillText('));
    expect(fallbackTextCalls.length).toBeGreaterThan(1);
    expect(new Set(fallbackTextCalls.map((call) => call.split(',').at(-1))).size).toBe(1);
  });

  it('keeps rich paragraph spacing in the painted line positions', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 200,
        h: 100,
        text: 'A\nB',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.2,
        paragraphSpacing: 12,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        textMode: 'area',
        richText: {
          paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B' }] }],
        },
      },
    };
    const rec = new MeasuredRecorder();
    replayIr(rec, [item]);
    const yPositions = rec.calls
      .filter((call) => call.startsWith('fillText('))
      .map((call) => Number(call.slice(0, -1).split(',').at(-1)));
    expect(yPositions).toHaveLength(2);
    expect(yPositions[1]! - yPositions[0]!).toBeCloseTo(16 * 1.2 + 12);
  });

  it('uses the tallest rich run line height for the next paragraph', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 200,
        h: 100,
        text: 'A\nB',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.2,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        textMode: 'area',
        richText: {
          paragraphs: [
            { runs: [{ text: 'A', format: { fontSize: 24, lineHeight: 2 } }] },
            { runs: [{ text: 'B' }] },
          ],
        },
      },
    };
    const rec = new MeasuredRecorder();
    replayIr(rec, [item]);
    const yPositions = rec.calls
      .filter((call) => call.startsWith('fillText('))
      .map((call) => Number(call.slice(0, -1).split(',').at(-1)));
    expect(yPositions).toHaveLength(2);
    // The second baseline must move past the first line's 48px line box. The
    // exact baseline delta also includes the two runs' different ascents.
    expect(yPositions[1]! - yPositions[0]!).toBeGreaterThan(32);
  });

  it('renders polygon via beginPath + polygon path + closePath + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 128, b: 0, a: 255 },
      primitive: { kind: 'polygon', cx: 50, cy: 50, radius: 40, sides: 6, rotation: 0 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('closePath(0)');
    expect(rec.calls).toContain('fill(0)');
    // moveTo for first vertex, lineTo for remaining sides
    expect(rec.calls).toContain('moveTo(2)');
    expect(rec.calls).toContain('lineTo(2)');
  });

  it('renders star via beginPath + star path + closePath + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 200, b: 0, a: 255 },
      primitive: {
        kind: 'star',
        cx: 50,
        cy: 50,
        innerRadius: 20,
        outerRadius: 40,
        points: 5,
        rotation: 0,
      },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('closePath(0)');
    expect(rec.calls).toContain('fill(0)');
    expect(rec.calls).toContain('moveTo(2)');
  });

  it('renders arrow as a stroked line with arrowhead', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: { kind: 'arrow', from: [0, 0], to: [100, 0], tolerance: 1, arrowheadSize: 10 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('moveTo(2)');
    expect(rec.calls).toContain('lineTo(2)');
    expect(rec.calls).toContain('stroke(0)');
  });

  it('renders a path primitive via bezierCurveTo + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 255, a: 255 },
      primitive: {
        kind: 'path',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: [10, 0] },
          { x: 50, y: 50, handleIn: [-10, 0], handleOut: null },
        ],
        closed: false,
        tolerance: 1,
      },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('bezierCurveTo(6)');
    expect(rec.calls).toContain('fill(0)');
  });

  it('renders a text primitive via fillText', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 100,
        h: 20,
        text: 'Hello',
        fontSize: 14,
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
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('fillText(3)');
    expect(String(rec.props.font ?? '')).toContain('14px');
  });

  it('replays pre-shaped RTL glyphs in visual order without reversing source text', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 100,
        h: 30,
        text: 'אב',
        fontSize: 16,
        fontFamily: 'Noto Sans Hebrew',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.2,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        direction: 'rtl',
        shaping: {
          runs: [
            {
              fontFamily: 'Noto Sans Hebrew',
              fontSize: 16,
              fontWeight: 400,
              fontStyle: 'normal',
              direction: 'rtl',
              level: 1,
              script: 'hebr',
              glyphs: [
                { glyphId: 11, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 0 },
                { glyphId: 12, xAdvance: 11, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 1 },
              ],
              width: 21,
              ascent: 12,
              descent: 4,
            },
          ],
          width: 21,
          height: 16,
          baseDirection: 'rtl',
          direction: 'rtl',
        },
      },
    };
    const rec = new Recorder();
    replayIr(rec, [item]);
    expect(rec.calls).toContain('fillText("ב",10,12)');
    expect(rec.calls).toContain('fillText("א",0,12)');
    expect(rec.calls.indexOf('fillText("ב",10,12)')).toBeLessThan(
      rec.calls.indexOf('fillText("א",0,12)'),
    );
  });

  it('renders a shape with image fill via the fill painting path', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      fills: [
        {
          type: 'image',
          src: 'data:image/png;base64,abc',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    // Falls through to fillRect placeholder since drawImage unavailable on recorder
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
  });

  it('renders a rounded rect via roundRect + fill when cornerRadius is set', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50, cornerRadius: 8 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    // With cornerRadius, must use roundRect path + fill rather than fillRect
    expect(rec.calls).toContain('roundRect(5)');
    expect(rec.calls).toContain('fill(0)');
    expect(rec.calls).not.toContain('fillRect(4)');
  });

  it('renders a rect without cornerRadius via fillRect', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('fillRect(4)');
  });

  it('frame does not occlude sibling: replay of two independent items preserves both fills', () => {
    // Simulates [frame-background, sibling-shape] IR order
    const frameItem: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 240, g: 240, b: 240, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 400, h: 300 },
    };
    const siblingItem: RenderItem = {
      transform: [1, 0, 0, 1, 50, 50],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    const rec = recorder();
    replayIr(rec.target, [frameItem, siblingItem]);
    // Both items must produce a fillRect call each
    const fillRects = rec.calls.filter((c) => c === 'fillRect(4)');
    expect(fillRects.length).toBe(2);
    // Save/restore must be balanced
    const saves = rec.calls.filter((c) => c === 'save(0)');
    const restores = rec.calls.filter((c) => c === 'restore(0)');
    expect(saves.length).toBe(restores.length);
  });

  // ── Phase C: Renderer Completion Tests ─────────────────────────────────

  it('renders uppercase textCase via transformed text', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'hello',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'uppercase' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    expect(rec.calls).toContain('fillText("HELLO",0,0)');
  });

  it('sets textBaseline from textAlignVertical', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Test',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'center' as const,
          textAlignVertical: 'middle' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 40,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    expect(rec.textBaseline).toBe('middle');
  });

  it('renders underline decoration', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Underlined',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'underline' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    // Underline draws a line: moveTo + lineTo + stroke
    expect(rec.calls.some((c) => c.startsWith('moveTo'))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('lineTo'))).toBe(true);
    expect(rec.calls.some((c) => c === 'stroke')).toBe(true);
  });

  // ── Bezier path rendering: single-handle transitions ───────────────

  /** Create a minimal ReplayTarget mock with spy-able methods. */
  function mockTarget(): {
    target: ReplayTarget;
    bezierCurveTo: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
  } {
    const bezierCurveTo = vi.fn();
    const lineTo = vi.fn();
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    return {
      target: {
        save: vi.fn(),
        restore: vi.fn(),
        clip: vi.fn(),
        transform: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        rect: vi.fn(),
        beginPath: vi.fn(),
        ellipse: vi.fn(),
        arc: vi.fn(),
        moveTo: vi.fn(),
        lineTo,
        bezierCurveTo,
        roundRect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        closePath: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        drawImage: vi.fn(),
        fillStyle: '',
        lineWidth: 1,
        lineCap: 'round' as CanvasLineCap,
        lineJoin: 'miter' as CanvasLineJoin,
        strokeStyle: '',
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        filter: 'none',
        lineDashOffset: 0,
        font: '',
        textAlign: 'left' as CanvasTextAlign,
        textBaseline: 'alphabetic' as CanvasTextBaseline,
      },
      bezierCurveTo,
      lineTo,
      drawImage,
      fillRect,
    };
  }

  it('path fill with only handleOut on prev anchor uses bezier not line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: [20, 30] },
            { x: 100, y: 100, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('path fill with only handleIn on current anchor uses bezier not line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 100, handleIn: [-20, -30], handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('path fill with handles on both anchors uses proper bezier', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 255, a: 255 },
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: [20, 30] },
            { x: 100, y: 100, handleIn: [-20, -30], handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('path fill with no handles uses straight line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 128, b: 0, a: 255 },
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 100, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.lineTo).toHaveBeenCalled();
    expect(m.bezierCurveTo).not.toHaveBeenCalled();
  });

  it('bezier stroke with only handleOut on prev anchor uses bezier not line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
            weight: 2,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'round',
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: [20, 30] },
            { x: 100, y: 100, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('bezier stroke with only handleIn on current anchor uses bezier not line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
            weight: 2,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'round',
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 100, handleIn: [-20, -30], handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('bezier stroke control points are absolute (anchor + handle offset), not relative', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
            weight: 2,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'round',
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 10, y: 20, handleIn: null, handleOut: [30, 40] },
            { x: 100, y: 200, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    // cp1 = anchor + handleOut = (10+30, 20+40) = (40, 60)
    // cp2 = degenerate: pt (100, 200)
    // end = (100, 200)
    expect(m.bezierCurveTo).toHaveBeenCalledWith(40, 60, 100, 200, 100, 200);
  });

  it('variable-width path stroke uses pressure to modulate width', () => {
    const m = recorder();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        opacity: 1,
        blendMode: 'normal',
        strokes: [
          {
            color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
            weight: 8,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'round' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 10, y: 20, handleIn: null, handleOut: null, pressure: 0.2 },
            { x: 100, y: 200, handleIn: null, handleOut: null, pressure: 0.8 },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    // Variable width sets lineWidth multiple times (one per segment)
    const lineWidthCalls = m.calls.filter((c) => c.startsWith('set lineWidth'));
    expect(lineWidthCalls.length).toBeGreaterThan(1);
    // At least some segments have lineWidth < 8 (from 0.2 pressure) and > 0
    const lineWidthValues = lineWidthCalls.map((_c) => m.props.lineWidth as number);
    expect(lineWidthValues.some((w) => w < 8)).toBe(true);
  });

  it('variable-width path stroke with uniform pressure falls back to uniform stroke', () => {
    const m = recorder();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        opacity: 1,
        blendMode: 'normal',
        strokes: [
          {
            color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
            weight: 8,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'round' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 10, y: 20, handleIn: null, handleOut: null, pressure: 0.5 },
            { x: 100, y: 200, handleIn: null, handleOut: null, pressure: 0.5 },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    // Uniform pressure: only one lineWidth set (not per-segment variable)
    const lineWidthCalls = m.calls.filter((c) => c.startsWith('set lineWidth'));
    expect(lineWidthCalls.length).toBe(1);
  });

  it('renders bulleted list with disc prefix', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Item 1\nItem 2',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'disc' as const,
          x: 0,
          y: 0,
          w: 200,
          h: 60,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    // Bullet list renders each line prefixed with •
    const fillCalls = rec.calls.filter((c) => c.startsWith('fillText'));
    expect(fillCalls.length).toBe(2);
    expect(rec.calls.some((c) => c.includes('•'))).toBe(true);
  });

  it('innerShadow on a rect primitive does not throw when the offscreen effect buffer is unavailable', () => {
    // innerShadow renders its silhouette via paintInsetEffect, which traces
    // the outline (rect() for an unrounded rect, since fillRect() is used as
    // a fast path for the base fill instead of rect()/fill()) onto a
    // *separate offscreen canvas* created by createEffectBuffer — never onto
    // `target` directly. In this test environment neither OffscreenCanvas
    // (stubbed to return a null context, see vitest.setup.ts) nor `document`
    // is available, so createEffectBuffer always returns null and
    // paintInsetEffect bails out before tracing anything. That means a
    // `rec.calls` assertion on rect()/ellipse() can never observe this
    // codepath — the achievable, meaningful assertion here (matching the
    // established convention in replay-fill.test.ts's "backgroundBlur
    // gracefully handles unavailable OffscreenCanvas") is that this
    // unavailability is handled gracefully rather than throwing.
    const rec = new Recorder();
    const effects: RenderItem['effects'] = [
      {
        type: 'innerShadow',
        x: 2,
        y: 2,
        blur: 4,
        spread: 0,
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
        opacity: 0.5,
        blendMode: 'normal' as const,
        visible: true,
      },
    ];
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0] as const,
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } as const,
      effects,
      primitive: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 100 },
    };
    expect(() => replayIr(rec, [item])).not.toThrow();
  });

  it('traceOutline handles ellipse primitive via ellipse() call', () => {
    const rec = new Recorder();
    const effects: RenderItem['effects'] = [
      {
        type: 'innerShadow',
        x: 0,
        y: 0,
        blur: 4,
        spread: 0,
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
        opacity: 0.5,
        blendMode: 'normal' as const,
        visible: true,
      },
    ];
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0] as const,
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } as const,
      effects,
      primitive: { kind: 'ellipse' as const, cx: 50, cy: 50, rx: 40, ry: 30 },
    };
    replayIr(rec, [item]);
    expect(rec.calls.some((c) => c.startsWith('ellipse('))).toBe(true);
  });

  it('justifies text by distributing extra space between words', () => {
    // With a wide frame (500px) and short text "Hello World", justification
    // should render each word separately with extra spacing.
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Hello World',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'justify' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 500,
          h: 20,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    // With justify, each word is rendered as a separate fillText call
    const fillCalls = rec.calls.filter((c) => c.startsWith('fillText'));
    expect(fillCalls.length).toBeGreaterThanOrEqual(2);
    // Words should be at different x positions (not at the same x origin)
    expect(fillCalls[0]).toContain('"Hello"');
    expect(fillCalls[1]).toContain('"World"');
  });

  it('wraps area text to its explicit container width', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        text: 'one two three four',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.4,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'clip',
        listStyle: 'none',
        textMode: 'area',
        x: 0,
        y: 0,
        w: 70,
        h: 100,
      },
    };
    const rec = new Recorder();
    replayIr(rec, [item]);
    const fillCalls = rec.calls.filter((call) => call.startsWith('fillText'));
    expect(fillCalls.length).toBeGreaterThan(1);
    expect(fillCalls[0]).not.toContain('one two three four');
  });

  it('applies firstLineIndent to the first line only', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'First\nSecond',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 200,
          h: 60,
          firstLineIndent: 40,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    const fillCalls = rec.calls.filter((c) => c.startsWith('fillText'));
    // First line should be at x=40 (left + firstLineIndent), second line at x=0
    expect(fillCalls.length).toBe(2);
    // fillText format: fillText("text",x,y)
    expect(fillCalls[0]).toMatch(/fillText\("[^"]+",40,/);
    expect(fillCalls[1]).toMatch(/fillText\("[^"]+",0,/);
  });
});
