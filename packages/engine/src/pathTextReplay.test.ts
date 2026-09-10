/**
 * Tests for path text rendering in the replay pipeline.
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import type { RenderItem } from './types';

function createMockTarget() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const state = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'top' as CanvasTextBaseline,
  };
  return {
    calls,
    state,
    save() {
      calls.push({ fn: 'save', args: [] });
    },
    restore() {
      calls.push({ fn: 'restore', args: [] });
    },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push({ fn: 'transform', args: [a, b, c, d, e, f] });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ fn: 'fillRect', args: [x, y, w, h] });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      calls.push({ fn: 'strokeRect', args: [x, y, w, h] });
    },
    beginPath() {
      calls.push({ fn: 'beginPath', args: [] });
    },
    closePath() {
      calls.push({ fn: 'closePath', args: [] });
    },
    moveTo(x: number, y: number) {
      calls.push({ fn: 'moveTo', args: [x, y] });
    },
    lineTo(x: number, y: number) {
      calls.push({ fn: 'lineTo', args: [x, y] });
    },
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
      calls.push({ fn: 'bezierCurveTo', args: [cp1x, cp1y, cp2x, cp2y, x, y] });
    },
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
      calls.push({ fn: 'quadraticCurveTo', args: [cpx, cpy, x, y] });
    },
    arc(x: number, y: number, r: number, start: number, end: number) {
      calls.push({ fn: 'arc', args: [x, y, r, start, end] });
    },
    fill() {
      calls.push({ fn: 'fill', args: [] });
    },
    stroke() {
      calls.push({ fn: 'stroke', args: [] });
    },
    set font(v: string) {
      state.font = v;
    },
    get font() {
      return state.font;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set textAlign(v: CanvasTextAlign) {
      state.textAlign = v;
    },
    get textAlign() {
      return state.textAlign;
    },
    set textBaseline(v: CanvasTextBaseline) {
      state.textBaseline = v;
    },
    get textBaseline() {
      return state.textBaseline;
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ fn: 'fillText', args: [text, x, y] });
    },
    strokeText(text: string, x: number, y: number) {
      calls.push({ fn: 'strokeText', args: [text, x, y] });
    },
    measureText(text: string) {
      return {
        width: text.length * 10,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 4,
      } as TextMetrics;
    },
    drawImage(src: string, x: number, y: number, w: number, h: number) {
      calls.push({ fn: 'drawImage', args: [src, x, y, w, h] });
    },
    createLinearGradient(_x1: number, _y1: number, _x2: number, _y2: number) {
      return { addColorStop: () => {} } as CanvasGradient;
    },
    createRadialGradient(
      _x1: number,
      _y1: number,
      _r1: number,
      _x2: number,
      _y2: number,
      _r2: number,
    ) {
      return { addColorStop: () => {} } as CanvasGradient;
    },
    createPattern(_image: CanvasImageSource, _repetition: string | null) {
      return {} as CanvasPattern;
    },
    clip() {
      calls.push({ fn: 'clip', args: [] });
    },
    scale(x: number, y: number) {
      calls.push({ fn: 'scale', args: [x, y] });
    },
    rotate(angle: number) {
      calls.push({ fn: 'rotate', args: [angle] });
    },
    translate(x: number, y: number) {
      calls.push({ fn: 'translate', args: [x, y] });
    },
  };
}

describe('path text rendering', () => {
  it('renders text along a line path', () => {
    const target = createMockTarget();
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
        primitive: {
          kind: 'text',
          x: 0,
          y: 0,
          w: 200,
          h: 20,
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
          textMode: 'path',
          pathTextSettings: {
            pathNodeId: 'path-1',
            side: 'top',
            startOffset: 0,
          },
          pathShape: {
            kind: 'line',
            from: [0, 50],
            to: [200, 50],
            tolerance: 1,
          },
        },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      },
    ];

    replayIr(target as unknown as import('./replay').ReplayTarget, items);

    const fillTextCalls = target.calls.filter((c) => c.fn === 'fillText');
    expect(fillTextCalls.length).toBe(3);

    const saveCalls = target.calls.filter((c) => c.fn === 'save');
    const restoreCalls = target.calls.filter((c) => c.fn === 'restore');
    expect(saveCalls.length).toBeGreaterThanOrEqual(3);
    expect(restoreCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('renders text along a circle path', () => {
    const target = createMockTarget();
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
        primitive: {
          kind: 'text',
          x: 0,
          y: 0,
          w: 100,
          h: 20,
          text: 'XY',
          fontSize: 14,
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
          textMode: 'path',
          pathTextSettings: {
            pathNodeId: 'circle-1',
            side: 'top',
          },
          pathShape: {
            kind: 'circle',
            cx: 100,
            cy: 100,
            r: 50,
          },
        },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      },
    ];

    replayIr(target as unknown as import('./replay').ReplayTarget, items);

    const fillTextCalls = target.calls.filter((c) => c.fn === 'fillText');
    expect(fillTextCalls.length).toBe(2);
  });

  it('skips path text when no pathShape is provided', () => {
    const target = createMockTarget();
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
        primitive: {
          kind: 'text',
          x: 0,
          y: 0,
          w: 100,
          h: 20,
          text: 'Test',
          fontSize: 14,
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
          textMode: 'path',
          pathTextSettings: {
            pathNodeId: 'missing',
          },
        },
        opacity: 1,
        blendMode: 'normal',
        strokes: [],
        effects: [],
      },
    ];

    replayIr(target as unknown as import('./replay').ReplayTarget, items);

    const fillTextCalls = target.calls.filter((c) => c.fn === 'fillText');
    expect(fillTextCalls.length).toBe(0);
  });
});
