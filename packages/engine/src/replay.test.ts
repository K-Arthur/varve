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
  const target = {
    save: mk('save'),
    restore: mk('restore'),
    transform: mk('transform'),
    fillRect: mk('fillRect'),
    beginPath: mk('beginPath'),
    ellipse: mk('ellipse'),
    arc: mk('arc'),
    moveTo: mk('moveTo'),
    lineTo: mk('lineTo'),
    fill: mk('fill'),
    stroke: mk('stroke'),
    get fillStyle() {
      return (props.fillStyle as string) ?? '';
    },
    set fillStyle(v: string) {
      props.fillStyle = v;
    },
    get lineWidth() {
      return (props.lineWidth as number) ?? 0;
    },
    set lineWidth(v: number) {
      props.lineWidth = v;
    },
    get lineCap() {
      return (props.lineCap as CanvasLineCap) ?? 'butt';
    },
    set lineCap(v: CanvasLineCap) {
      props.lineCap = v;
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
    expect(rec.calls).toEqual(['save(0)', 'transform(6)', 'fillRect(4)', 'restore(0)']);
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
    expect(rec.calls).toEqual([
      'save(0)',
      'transform(6)',
      'beginPath(0)',
      'ellipse(7)',
      'fill(0)',
      'restore(0)',
    ]);
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
    expect(rec.calls).toEqual([
      'save(0)',
      'transform(6)',
      'beginPath(0)',
      'moveTo(2)',
      'lineTo(2)',
      'stroke(0)',
      'restore(0)',
    ]);
    expect(rec.props.lineWidth).toBe(4); // tolerance * 2
    expect(rec.props.lineCap).toBe('round');
  });

  it('handles an empty IR', () => {
    const rec = recorder();
    replayIr(rec.target, []);
    expect(rec.calls).toEqual([]);
  });
});
