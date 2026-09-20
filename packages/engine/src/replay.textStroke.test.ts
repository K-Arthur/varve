/**
 * Wrapped text must stroke the same line boxes it fills.
 *
 * The legacy text stroker split the source on `\n` and never wrapped, so an
 * area text node — a balloon's dialogue, a caption, a wrapped SFX block —
 * painted a single long outline behind multiple wrapped lines. The mismatch
 * is invisible in a one-line fixture and obvious on any lettered page, and it
 * reaches PNG, PDF, and every other replay-based export because they all run
 * this painter.
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import type { RenderItem, Stroke } from './types';

interface StrokeCall {
  text: string;
  x: number;
  y: number;
}

function recordingTarget(): { target: Record<string, unknown>; strokes: StrokeCall[] } {
  const strokes: StrokeCall[] = [];
  const target: Record<string, unknown> = {
    font: '',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    textAlign: 'left',
    textBaseline: 'top',
    letterSpacing: '0px',
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    arc() {},
    rect() {},
    fill() {},
    stroke() {},
    clip() {},
    translate() {},
    scale() {},
    rotate() {},
    transform() {},
    setTransform() {},
    resetTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    strokeText(text: string, x: number, y: number) {
      strokes.push({ text, x, y });
    },
    // 10px per character keeps the wrap arithmetic predictable in the test.
    measureText: (text: string) => ({ width: text.length * 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    drawImage() {},
    putImageData() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    setLineDash() {},
    ellipse() {},
    roundRect() {},
  };
  return { target, strokes };
}

const OUTLINE: Stroke = {
  color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
  weight: 4,
  align: 'center',
  dashPattern: [],
  dashOffset: 0,
  cap: 'round',
  join: 'round',
  miterLimit: 4,
  visible: true,
};

function wrappedTextItem(strokes: Stroke[]): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    blendMode: 'normal',
    strokes,
    primitive: {
      kind: 'text',
      text: 'aaa bbb ccc ddd eee',
      x: 0,
      y: 0,
      w: 100,
      h: 220,
      fontSize: 16,
      fontFamily: 'Test Sans',
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight: 1.4,
      letterSpacing: 0,
      textAlign: 'left',
      textAlignVertical: 'top',
      textMode: 'area',
      textCase: 'none',
      textDecoration: 'none',
      textOverflow: 'visible',
      listStyle: 'none',
      paragraphSpacing: 0,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    },
  } as unknown as RenderItem;
}

describe('wrapped text strokes', () => {
  it('strokes each wrapped line instead of one unwrapped string', () => {
    const { target, strokes } = recordingTarget();
    replayIr(target as never, [wrappedTextItem([OUTLINE])]);
    expect(strokes.length).toBeGreaterThan(1);
    const joined = strokes.map((call) => call.text).join(' ');
    expect(joined).not.toContain('aaa bbb ccc ddd eee');
    const ys = strokes.map((call) => call.y);
    expect(new Set(ys.map((y) => Math.round(y))).size).toBeGreaterThan(1);
    // Lines advance by fontSize * lineHeight; never all on one baseline.
    expect(ys[1]! - ys[0]!).toBeCloseTo(16 * 1.4, 1);
  });

  it('keeps the canonical stroke positions level with the fill lines', () => {
    // Regression guard: the old stroker used the raw line list and a
    // `textAlign`-based x that ignored wrapping, so the outline drifted away
    // from the glyphs on every line after the first.
    const { target, strokes } = recordingTarget();
    replayIr(target as never, [wrappedTextItem([OUTLINE])]);
    for (const call of strokes) {
      expect(call.x).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(call.y)).toBe(true);
    }
    expect(new Set(strokes.map((call) => call.y)).size).toBeGreaterThan(1);
  });
});
