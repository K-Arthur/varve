import { describe, expect, it } from 'vitest';
import type { BrushDab } from '../brush';
import { featheredRectCoverage, makeCoverageMask } from '../paintCoverage';
import {
  compositeDabOnNode,
  createEmptyTile,
  eraseDabOnNode,
  makeRasterLayerNode,
  makeTileKey,
  TILE_SIZE,
} from '../rasterLayer';
import type { RasterLayerNode } from '../types';

function dab(overrides: Partial<BrushDab> = {}): BrushDab {
  return {
    x: 20,
    y: 20,
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

/** Layer whose first tile is prefilled with one RGBA value. */
function layerFilled(r: number, g: number, b: number, a: number): RasterLayerNode {
  const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
  const tile = createEmptyTile();
  for (let i = 0; i < tile.pixels.length; i += 4) {
    tile.pixels[i] = r;
    tile.pixels[i + 1] = g;
    tile.pixels[i + 2] = b;
    tile.pixels[i + 3] = a;
  }
  node.tiles.set(makeTileKey(0, 0), tile);
  return node;
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

const RED = [255, 0, 0, 255] as const;

describe('alpha lock', () => {
  it('paints nothing onto fully transparent pixels', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const out = compositeDabOnNode(node, dab(), RED, { alphaLock: true });
    expect(out.tiles.size).toBe(0);
  });

  it('preserves destination alpha exactly on partially transparent pixels', () => {
    const node = layerFilled(0, 0, 255, 128);
    const out = compositeDabOnNode(node, dab(), RED, { alphaLock: true });
    expect(px(out, 20, 20)!.a).toBe(128);
  });

  it('scales coverage by destination alpha, so a half-alpha pixel takes half the paint', () => {
    const half = compositeDabOnNode(layerFilled(0, 0, 255, 128), dab(), RED, { alphaLock: true });
    const full = compositeDabOnNode(layerFilled(0, 0, 255, 255), dab(), RED, { alphaLock: true });
    const halfPx = px(half, 20, 20)!;
    const fullPx = px(full, 20, 20)!;
    // Opaque destination takes the paint completely; half-alpha only partly.
    expect(fullPx.r).toBe(255);
    expect(halfPx.r).toBeGreaterThan(100);
    expect(halfPx.r).toBeLessThan(230);
    expect(halfPx.b).toBeGreaterThan(0);
  });

  it('is a no-op difference from unlocked painting on fully opaque pixels', () => {
    const locked = compositeDabOnNode(layerFilled(0, 0, 255, 255), dab(), RED, { alphaLock: true });
    const unlocked = compositeDabOnNode(layerFilled(0, 0, 255, 255), dab(), RED, false);
    expect(px(locked, 20, 20)).toEqual(px(unlocked, 20, 20));
  });

  it('applies to blend modes too', () => {
    const out = compositeDabOnNode(
      layerFilled(200, 200, 200, 100),
      dab({ blendMode: 'multiply' }),
      RED,
      {
        alphaLock: true,
      },
    );
    expect(px(out, 20, 20)!.a).toBe(100);
  });
});

describe('selection coverage', () => {
  it('clips paint to the covered region', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const coverage = makeCoverageMask(20, 0, 40, TILE_SIZE, 255);
    const out = compositeDabOnNode(node, dab({ x: 20, y: 20, radius: 10 }), RED, { coverage });
    expect(px(out, 25, 20)!.a).toBeGreaterThan(0); // inside
    expect(px(out, 15, 20)!.a).toBe(0); // outside
  });

  it('attenuates rather than hard-clips a feathered selection', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const coverage = featheredRectCoverage(0, 0, 64, 64, 16);
    const out = compositeDabOnNode(node, dab({ x: 32, y: 8, radius: 6 }), RED, { coverage });
    const nearEdge = px(out, 32, 4)!.a;
    const inside = px(out, 32, 10)!.a;
    expect(nearEdge).toBeGreaterThan(0);
    expect(nearEdge).toBeLessThan(inside);
  });

  it('paints nothing through an empty selection', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const coverage = makeCoverageMask(0, 0, TILE_SIZE, TILE_SIZE, 0);
    const out = compositeDabOnNode(node, dab(), RED, { coverage });
    expect(out.tiles.size).toBe(0);
  });

  it('constrains the eraser as well', () => {
    const node = layerFilled(0, 0, 255, 255);
    const coverage = makeCoverageMask(20, 0, 40, TILE_SIZE, 255);
    const out = eraseDabOnNode(node, dab({ x: 20, y: 20, radius: 10 }), { coverage });
    expect(px(out, 25, 20)!.a).toBeLessThan(255); // erased inside
    expect(px(out, 15, 20)!.a).toBe(255); // untouched outside
  });

  it('combines with alpha lock', () => {
    const node = layerFilled(0, 0, 255, 255);
    const coverage = makeCoverageMask(20, 0, 40, TILE_SIZE, 128);
    const out = compositeDabOnNode(node, dab({ x: 20, y: 20, radius: 10 }), RED, {
      alphaLock: true,
      coverage,
    });
    const inside = px(out, 25, 20)!;
    expect(inside.a).toBe(255);
    expect(inside.r).toBeGreaterThan(0);
    expect(inside.r).toBeLessThan(255);
    expect(px(out, 15, 20)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });
});

describe('brush tip roundness', () => {
  it('thins the minor axis instead of growing it', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const out = compositeDabOnNode(node, dab({ x: 40, y: 40, radius: 16, roundness: 0.25 }), RED);
    // Wide along x (major axis), narrow along y (minor axis).
    expect(px(out, 40 + 12, 40)!.a).toBeGreaterThan(0);
    expect(px(out, 40, 40 + 12)!.a).toBe(0);
  });
});

describe('source-over compositing', () => {
  it('paints new colour over existing opaque pixels', () => {
    // Regression: the normal-blend path used to composite destination-over-
    // source, so a second stroke over an opaque first stroke was invisible.
    const node = layerFilled(0, 0, 255, 255);
    const out = compositeDabOnNode(node, dab(), RED);
    expect(px(out, 20, 20)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('blends proportionally at partial opacity', () => {
    const node = layerFilled(0, 0, 255, 255);
    const out = compositeDabOnNode(node, dab({ opacity: 0.5 }), RED);
    const p = px(out, 20, 20)!;
    expect(p.a).toBe(255);
    expect(p.r).toBeGreaterThan(100);
    expect(p.r).toBeLessThan(160);
    expect(p.b).toBeGreaterThan(100);
    expect(p.b).toBeLessThan(160);
  });

  it('accumulates alpha when painting semi-transparent over transparent', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    let out = compositeDabOnNode(node, dab({ opacity: 0.5 }), RED);
    const first = px(out, 20, 20)!.a;
    out = compositeDabOnNode(out, dab({ opacity: 0.5 }), RED);
    expect(px(out, 20, 20)!.a).toBeGreaterThan(first);
  });
});

describe('brush tip hardness', () => {
  it('gives a hard edge at hardness 1', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const out = compositeDabOnNode(node, dab({ x: 40, y: 40, radius: 12, hardness: 1 }), RED);
    // Solid right up to the rim, then nothing.
    expect(px(out, 40 + 10, 40)!.a).toBe(255);
    expect(px(out, 40 + 13, 40)!.a).toBe(0);
  });

  it('falls off from the centre at low hardness', () => {
    // Regression: hardness was inverted, so "Airbrush" at hardness 0.1
    // rendered as a hard-edged disc instead of a soft one.
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const out = compositeDabOnNode(node, dab({ x: 40, y: 40, radius: 12, hardness: 0.1 }), RED);
    const centre = px(out, 40, 40)!.a;
    const mid = px(out, 40 + 6, 40)!.a;
    const rim = px(out, 40 + 11, 40)!.a;
    expect(centre).toBe(255);
    expect(mid).toBeLessThan(centre);
    expect(rim).toBeLessThan(mid);
    expect(rim).toBeGreaterThan(0);
  });

  it('makes a higher hardness cover more of the tip solidly', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const soft = compositeDabOnNode(node, dab({ x: 40, y: 40, radius: 12, hardness: 0.2 }), RED);
    const hard = compositeDabOnNode(node, dab({ x: 40, y: 40, radius: 12, hardness: 0.8 }), RED);
    expect(px(hard, 40 + 8, 40)!.a).toBeGreaterThan(px(soft, 40 + 8, 40)!.a);
  });
});

describe('wet edge', () => {
  const wetDab = () => dab({ x: 40, y: 40, radius: 16, hardness: 1, opacity: 0.6 });

  it('darkens the rim relative to the centre', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const out = compositeDabOnNode(node, wetDab(), RED, {
      wetEdge: { size: 0.3, darken: 0.6 },
    });
    const centre = px(out, 40, 40)!;
    const rim = px(out, 40 + 14, 40)!;
    // Pigment pools at the rim: more coverage and a deeper tone.
    expect(rim.a).toBeGreaterThan(centre.a);
    expect(rim.r).toBeLessThan(centre.r);
  });

  it('leaves the dab unchanged when the effect is off', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const plain = compositeDabOnNode(node, wetDab(), RED);
    const zeroed = compositeDabOnNode(node, wetDab(), RED, { wetEdge: { size: 0.3, darken: 0 } });
    expect(px(zeroed, 40 + 14, 40)).toEqual(px(plain, 40 + 14, 40));
  });

  it('does not affect the interior of the dab', () => {
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const plain = compositeDabOnNode(node, wetDab(), RED);
    const wet = compositeDabOnNode(node, wetDab(), RED, { wetEdge: { size: 0.2, darken: 0.8 } });
    expect(px(wet, 40, 40)).toEqual(px(plain, 40, 40));
  });

  it('is measured against the tip radius, so zoom cannot change it', () => {
    // Two dabs of different radii show the same relative rim darkening at the
    // same fraction of their radius — the effect is brush-relative, not
    // canvas-relative, which is how a wet edge usually goes wrong.
    const node = makeRasterLayerNode('n', { width: TILE_SIZE, height: TILE_SIZE });
    const edge = { size: 0.25, darken: 0.6 };
    const small = compositeDabOnNode(
      node,
      dab({ x: 32, y: 32, radius: 10, hardness: 1, opacity: 0.6 }),
      RED,
      { wetEdge: edge },
    );
    const large = compositeDabOnNode(
      node,
      dab({ x: 32, y: 32, radius: 20, hardness: 1, opacity: 0.6 }),
      RED,
      { wetEdge: edge },
    );
    const smallRim = px(small, 32 + 9, 32)!;
    const largeRim = px(large, 32 + 18, 32)!;
    expect(Math.abs(smallRim.a - largeRim.a)).toBeLessThanOrEqual(6);
  });

  it('still respects alpha lock at the rim', () => {
    const out = compositeDabOnNode(layerFilled(0, 0, 255, 120), wetDab(), RED, {
      alphaLock: true,
      wetEdge: { size: 0.3, darken: 0.8 },
    });
    expect(px(out, 40 + 14, 40)!.a).toBe(120);
  });
});
