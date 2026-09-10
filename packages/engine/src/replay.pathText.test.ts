/**
 * Path text has to actually paint.
 *
 * A capture showed the badge's label disappearing the moment it was attached
 * to the ring: the settings were present, the path resolved, and the canvas
 * drew nothing. `paintPathText` returns early when it has no path shape, and
 * a silent early return is indistinguishable from "the offset had no effect"
 * from outside.
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import type { RenderItem } from './types';

function recordingTarget() {
  const drawn: Array<{ text: string; x: number; y: number }> = [];
  // paintPathText positions each glyph with a transform and then draws it at
  // the origin, so the fillText arguments are always (0, 0) — the placement
  // lives in the transform calls.
  const placements: number[][] = [];
  const target = {
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
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      placements.push([a, b, c, d, e, f]);
    },
    setTransform() {},
    resetTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    fillText(text: string, x: number, y: number) {
      drawn.push({ text, x, y });
    },
    strokeText() {},
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
  return { target, drawn, placements };
}

/** A text primitive attached to a circle, as the editor builds one. */
function pathTextItem(startOffset: number, withPathShape = true): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    blendMode: 'normal',
    primitive: {
      kind: 'text',
      text: 'VELO',
      x: 0,
      y: 0,
      w: 300,
      h: 40,
      fontSize: 32,
      fontFamily: 'IBM Plex Sans Variable',
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight: 1.2,
      letterSpacing: 0,
      textAlign: 'left',
      textAlignVertical: 'top',
      textMode: 'path',
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      pathTextSettings: { pathNodeId: 'ring-1', startOffset, side: 'top' },
      ...(withPathShape ? { pathShape: { kind: 'circle', cx: 200, cy: 200, r: 140 } } : {}),
    },
  } as unknown as RenderItem;
}

describe('path text painting', () => {
  it('draws the glyphs when the path shape is resolved', () => {
    const { target, drawn } = recordingTarget();
    replayIr(target as never, [pathTextItem(0)]);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.map((d) => d.text).join('')).toContain('V');
  });

  it('places them at different points when the start offset moves', () => {
    const a = recordingTarget();
    replayIr(a.target as never, [pathTextItem(0)]);
    const b = recordingTarget();
    replayIr(b.target as never, [pathTextItem(0.3)]);
    expect(a.drawn.length).toBeGreaterThan(0);
    expect(b.drawn.length).toBeGreaterThan(0);
    // Same glyphs, different translations around the circle.
    expect(JSON.stringify(a.placements)).not.toBe(JSON.stringify(b.placements));
  });

  it('draws nothing without a resolved path — the regression to catch', () => {
    // This is the state the capture hit: settings present, geometry absent.
    const { target, drawn } = recordingTarget();
    replayIr(target as never, [pathTextItem(0, false)]);
    expect(drawn.length).toBe(0);
  });
});
