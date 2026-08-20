import { describe, expect, it } from 'vitest';
import type { BrushDab } from '../brush';
import {
  compositeSmudgeDab,
  createSmudgeState,
  type SmudgeOptions,
  type SmudgeState,
} from '../smudge';
import {
  createEmptyTile,
  makeRasterLayerNode,
  makeTileKey,
  TILE_SIZE,
} from '../rasterLayer';
import type { RasterLayerNode } from '../types';

function dab(x: number, y: number, overrides: Partial<BrushDab> = {}): BrushDab {
  return {
    x,
    y,
    radius: 8,
    opacity: 1,
    flow: 1,
    hardness: 1,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
    shape: 'circle',
    blendMode: 'normal',
    ...overrides,
  };
}

/** Left half red, right half blue, both opaque. */
function splitLayer(): RasterLayerNode {
  const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
  const tile = createEmptyTile();
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const i = (y * TILE_SIZE + x) * 4;
      const left = x < TILE_SIZE / 2;
      tile.pixels[i] = left ? 255 : 0;
      tile.pixels[i + 1] = 0;
      tile.pixels[i + 2] = left ? 0 : 255;
      tile.pixels[i + 3] = 255;
    }
  }
  node.tiles.set(makeTileKey(0, 0), tile);
  return node;
}

function emptyLayer(): RasterLayerNode {
  return makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
}

function px(node: RasterLayerNode, x: number, y: number) {
  const tile = node.tiles.get(makeTileKey(0, 0));
  if (!tile) return null;
  const i = (y * TILE_SIZE + x) * 4;
  return {
    r: tile.pixels[i]!,
    g: tile.pixels[i + 1]!,
    b: tile.pixels[i + 2]!,
    a: tile.pixels[i + 3]!,
  };
}

function opts(overrides: Partial<SmudgeOptions> = {}): SmudgeOptions {
  return {
    mode: 'pure',
    strength: 0.8,
    pickup: 0.6,
    foreground: [0, 255, 0, 255],
    ...overrides,
  };
}

/** Drag from `fromX` to `toX` along y, one dab every 4px. */
function drag(
  node: RasterLayerNode,
  state: SmudgeState,
  options: SmudgeOptions,
  fromX: number,
  toX: number,
  y: number,
): RasterLayerNode {
  let current = node;
  for (let x = fromX; x <= toX; x += 4) {
    current = compositeSmudgeDab(current, dab(x, y), state, options);
  }
  return current;
}

describe('smudge reservoir', () => {
  it('transports existing pigment across a colour boundary', () => {
    const options = opts({ pickup: 0.3 });
    const state = createSmudgeState(options);
    // Start in the red half, drag into the blue half; the boundary is x=64.
    const out = drag(splitLayer(), state, options, 50, 80, 40);
    const untouched = px(splitLayer(), 72, 40)!;
    const smudged = px(out, 72, 40)!;
    expect(untouched.r).toBe(0);
    expect(smudged.r).toBeGreaterThan(20);
    expect(smudged.b).toBeLessThan(255);
  });

  it('fades the trail with distance instead of repeating forever', () => {
    const state = createSmudgeState(opts());
    const out = drag(splitLayer(), state, opts(), 50, 110, 40);
    const near = px(out, 70, 40)!.r;
    const far = px(out, 106, 40)!.r;
    expect(near).toBeGreaterThan(far);
  });

  it('deposits nothing on a transparent canvas in pure mode', () => {
    const state = createSmudgeState(opts());
    const out = drag(emptyLayer(), state, opts(), 40, 80, 40);
    expect(px(out, 60, 40)?.a ?? 0).toBe(0);
  });

  it('deposits foreground pigment on a transparent canvas in finger paint', () => {
    const options = opts({ mode: 'fingerPaint', foreground: [0, 255, 0, 255] });
    const state = createSmudgeState(options);
    const out = drag(emptyLayer(), state, options, 40, 80, 40);
    const p = px(out, 60, 40)!;
    expect(p.a).toBeGreaterThan(0);
    expect(p.g).toBeGreaterThan(60);
  });

  it('starts loaded mode with a full reservoir of foreground colour', () => {
    const options = opts({ mode: 'loaded', foreground: [0, 255, 0, 255], initialLoad: 1 });
    const state = createSmudgeState(options);
    expect(state.load).toBe(1);
    expect(state.g).toBe(255);
    const out = compositeSmudgeDab(emptyLayer(), dab(40, 40), state, options);
    expect(px(out, 40, 40)!.g).toBeGreaterThan(0);
  });

  it('picks up before it deposits, so a dab both takes and leaves colour', () => {
    const state = createSmudgeState(opts());
    compositeSmudgeDab(splitLayer(), dab(30, 40), state, opts());
    // After one dab over the red half the reservoir holds red.
    expect(state.load).toBeGreaterThan(0);
    expect(state.r).toBeGreaterThan(state.b);
  });

  it('respects alpha lock by preserving destination alpha', () => {
    const node = splitLayer();
    const options = opts({ alphaLock: true, mode: 'fingerPaint' });
    const state = createSmudgeState(options);
    const out = drag(node, state, options, 40, 80, 40);
    expect(px(out, 60, 40)!.a).toBe(255);
  });

  it('never paints into transparent pixels under alpha lock', () => {
    const options = opts({ alphaLock: true, mode: 'fingerPaint' });
    const state = createSmudgeState(options);
    const out = drag(emptyLayer(), state, options, 40, 80, 40);
    expect(out.tiles.size).toBe(0);
  });

  it('clips to selection coverage', () => {
    const options = opts({
      mode: 'fingerPaint',
      coverage: {
        x: 50,
        y: 0,
        width: 40,
        height: TILE_SIZE,
        data: new Uint8Array(40 * TILE_SIZE).fill(255),
      },
    });
    const state = createSmudgeState(options);
    const out = drag(emptyLayer(), state, options, 30, 80, 40);
    expect(px(out, 60, 40)!.a).toBeGreaterThan(0);
    expect(px(out, 40, 40)?.a ?? 0).toBe(0);
  });

  it('leaves the layer untouched when nothing has been picked up', () => {
    const node = emptyLayer();
    const state = createSmudgeState(opts());
    const out = compositeSmudgeDab(node, dab(40, 40), state, opts());
    expect(out).toBe(node);
  });
});
