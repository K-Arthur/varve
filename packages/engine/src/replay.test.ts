import { describe, expect, it } from 'vitest';
import type { ReplayTarget } from './replay';
import { replayIr } from './replay';
import type { RenderItem } from './types';

interface Recorder {
  target: ReplayTarget;
  calls: string[];
  props: Record<string, unknown>;
}

function recorder(): Recorder {
  const calls: string[] = [];
  const props: Record<string, unknown> = {};
  const mk =
    (k: string) =>
    (...args: unknown[]) =>
      calls.push(`${k}(${args.length})`);
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

describe('replayIr', () => {
  it('replays a rect: save, transform, fillStyle, fillRect, restore', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 10, 20],
      fill: [57, 208, 198, 255],
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
    expect(rec.props.fillStyle).toBe('rgba(57, 208, 198, 1.000)');
  });

  it('replays an ellipse via beginPath + ellipse + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [255, 0, 0, 255],
      primitive: { kind: 'ellipse', cx: 1, cy: 2, rx: 3, ry: 4 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('ellipse(7)');
    expect(rec.calls).toContain('fill(0)');
  });

  it('replays a circle via arc', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      primitive: { kind: 'circle', cx: 0, cy: 0, r: 5 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('arc(5)');
    expect(rec.calls).toContain('fill(0)');
  });

  it('replays a line as a stroked segment with tolerance width', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 0, 255],
      primitive: { kind: 'line', from: [0, 0], to: [10, 0], tolerance: 2 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('moveTo(2)');
    expect(rec.calls).toContain('lineTo(2)');
    expect(rec.calls).toContain('stroke(0)');
    expect(rec.props.lineWidth).toBe(4);
    expect(rec.props.lineCap).toBe('round');
  });

  it('applies item opacity via globalAlpha', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [255, 0, 0, 255],
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
      fill: [255, 0, 0, 255],
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
        fill: [255, 0, 0, 255],
        opacity: 0.5,
        blendMode: 'screen',
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      },
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: [0, 0, 255, 255],
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

  it('renders polygon via beginPath + polygon path + closePath + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 128, 0, 255],
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
      fill: [255, 200, 0, 255],
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
      fill: [0, 0, 0, 255],
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
      fill: [255, 0, 255, 255],
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
      fill: [0, 0, 0, 255],
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
      },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('fillText(3)');
    expect(String(rec.props.font ?? '')).toContain('14px');
  });

  it('renders an image primitive as a placeholder fillRect', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [200, 200, 200, 255],
      primitive: { kind: 'image', w: 100, h: 80, src: 'data:image/png;base64,abc' },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('fillRect(4)');
  });

  it('renders a rounded rect via roundRect + fill when cornerRadius is set', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: [0, 0, 255, 255],
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
      fill: [255, 0, 0, 255],
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
      fill: [240, 240, 240, 255],
      primitive: { kind: 'rect', x: 0, y: 0, w: 400, h: 300 },
    };
    const siblingItem: RenderItem = {
      transform: [1, 0, 0, 1, 50, 50],
      fill: [255, 0, 0, 255],
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
});
