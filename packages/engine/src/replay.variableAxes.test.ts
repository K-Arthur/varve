/**
 * Variable-font axes have to reach the Canvas2D painter.
 *
 * A CanvasRenderingContext2D `font` is a CSS font shorthand, and the
 * shorthand carries no `font-variation-settings`. So the axis values the
 * inspector writes were stored on the node, forwarded to the engine node and
 * folded into the IR cache key — and then dropped at the point of drawing.
 * Dragging a weight axis changed the document and left the glyphs untouched.
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import type { RenderItem } from './types';

/** Records every font string the painter assigns. */
function recordingTarget() {
  const fonts: string[] = [];
  const target = {
    _font: '',
    get font() {
      return this._font;
    },
    set font(v: string) {
      this._font = v;
      fonts.push(v);
    },
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
    strokeText() {},
    measureText: () => ({ width: 10 }),
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
  return { target, fonts };
}

function textItem(variableAxes?: Record<string, number>): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    blendMode: 'normal',
    primitive: {
      kind: 'text',
      text: 'Aa',
      x: 0,
      y: 0,
      w: 400,
      h: 120,
      fontSize: 96,
      fontFamily: 'IBM Plex Sans Variable',
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight: 1.1,
      letterSpacing: 0,
      textAlign: 'left',
      textAlignVertical: 'top',
      textMode: 'point',
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      ...(variableAxes ? { variableAxes } : {}),
    },
  } as unknown as RenderItem;
}

const weightsFrom = (fonts: string[]) =>
  fonts.map((f) => Number(f.match(/(?:italic\s+)?(\d+)\s+\d+px/)?.[1] ?? Number.NaN));

describe('variable font axes in the Canvas2D painter', () => {
  it('draws at the font weight when no axis is set', () => {
    const { target, fonts } = recordingTarget();
    replayIr(target as never, [textItem()]);
    expect(weightsFrom(fonts)).toContain(400);
  });

  it('draws at the wght axis value when one is set', () => {
    const { target, fonts } = recordingTarget();
    replayIr(target as never, [textItem({ wght: 700 })]);
    const weights = weightsFrom(fonts);
    expect(weights).toContain(700);
    // Regression: the axis used to be dropped and 400 drawn regardless.
    expect(weights).not.toContain(400);
  });

  it('lets the axis override a differing fontWeight', () => {
    const { target, fonts } = recordingTarget();
    replayIr(target as never, [textItem({ wght: 150 })]);
    expect(weightsFrom(fonts)).toContain(150);
  });

  it('clamps an out-of-range axis to what the shorthand accepts', () => {
    const { target, fonts } = recordingTarget();
    replayIr(target as never, [textItem({ wght: 5000 })]);
    expect(weightsFrom(fonts)).toContain(1000);
  });

  it('ignores axes the shorthand cannot express and keeps the weight', () => {
    // opsz has no CSS shorthand slot; it must not corrupt the font string.
    const { target, fonts } = recordingTarget();
    replayIr(target as never, [textItem({ opsz: 96 })]);
    expect(weightsFrom(fonts)).toContain(400);
    expect(fonts.every((f) => !f.includes('opsz'))).toBe(true);
  });
});
