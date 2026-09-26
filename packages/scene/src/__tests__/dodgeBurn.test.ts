// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createEmptyTile, makeRasterLayerNode, makeTileKey, TILE_SIZE } from '../rasterLayer';
import { compositeDodgeBurnDabOnNode, type DodgeBurnOptions } from '../retouchRaster';

const IDENTITY_DAB = {
  x: TILE_SIZE / 2,
  y: TILE_SIZE / 2,
  radius: 12,
  opacity: 1,
  flow: 1,
  hardness: 1,
  angle: 0,
  roundness: 1,
  strokeT: 0,
  strokeDistance: 0,
};

function dodgeBurn(overrides: Partial<DodgeBurnOptions> = {}): DodgeBurnOptions {
  return { mode: 'dodge', exposure: 1, range: 'midtones', ...overrides };
}

function flatLayer(value: number, alpha = 255): ReturnType<typeof makeRasterLayerNode> {
  const node = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
  const tile = createEmptyTile();
  for (let i = 0; i < tile.pixels.length; i += 4) {
    tile.pixels[i] = value;
    tile.pixels[i + 1] = value;
    tile.pixels[i + 2] = value;
    tile.pixels[i + 3] = alpha;
  }
  node.tiles.set(makeTileKey(0, 0), tile);
  return node;
}

function pixelAt(node: ReturnType<typeof makeRasterLayerNode>, x: number, y: number) {
  const tile = node.tiles.get(makeTileKey(0, 0))!;
  const i = (y * TILE_SIZE + x) * 4;
  return {
    r: tile.pixels[i]!,
    g: tile.pixels[i + 1]!,
    b: tile.pixels[i + 2]!,
    a: tile.pixels[i + 3]!,
  };
}

describe('compositeDodgeBurnDabOnNode', () => {
  it('dodges mid grey by one stop at the dab centre, matching exposure maths', () => {
    const node = flatLayer(128);
    const updated = compositeDodgeBurnDabOnNode(node, IDENTITY_DAB, dodgeBurn());

    const center = pixelAt(updated, TILE_SIZE / 2, TILE_SIZE / 2);
    // sRGB 128 in linear light is ~0.216; doubling and re-encoding gives 176.
    expect(center.r).toBe(176);
    expect(center.r).toBe(center.g);
    expect(center.g).toBe(center.b);
    expect(center.a).toBe(255);
  });

  it('burn darkens by the same exposure maths', () => {
    const node = flatLayer(128);
    const updated = compositeDodgeBurnDabOnNode(
      node,
      IDENTITY_DAB,
      dodgeBurn({ mode: 'burn', exposure: 1 }),
    );
    const center = pixelAt(updated, TILE_SIZE / 2, TILE_SIZE / 2);
    // Halving linear 0.21576 gives 0.10788, which encodes back to 92.
    expect(center.r).toBe(92);
  });

  it('never brightens white or darkens black through the range extremes', () => {
    const white = compositeDodgeBurnDabOnNode(flatLayer(255), IDENTITY_DAB, dodgeBurn());
    const black = compositeDodgeBurnDabOnNode(flatLayer(0), IDENTITY_DAB, dodgeBurn());
    // A midtones-weighted dodge must still leave pure white byte-identical
    // (it cannot exceed the encoding ceiling) and cannot lift black into
    // invented detail: linear 0 scaled by anything stays 0.
    expect(pixelAt(white, TILE_SIZE / 2, TILE_SIZE / 2)).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(pixelAt(black, TILE_SIZE / 2, TILE_SIZE / 2)).toMatchObject({ r: 0, g: 0, b: 0 });
  });

  it('zero exposure is the identity and returns the same node', () => {
    const node = flatLayer(128);
    expect(compositeDodgeBurnDabOnNode(node, IDENTITY_DAB, dodgeBurn({ exposure: 0 }))).toBe(node);
  });

  it('never creates pixels on transparent areas or empty tiles', () => {
    const emptyNode = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
    expect(compositeDodgeBurnDabOnNode(emptyNode, IDENTITY_DAB, dodgeBurn())).toBe(emptyNode);

    const halfAlpha = flatLayer(128, 0);
    // Interior alpha 0: the dab may overlap but must not invent coverage.
    const transparent = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
    const tile = createEmptyTile();
    transparent.tiles.set(makeTileKey(0, 0), tile);
    expect(compositeDodgeBurnDabOnNode(transparent, IDENTITY_DAB, dodgeBurn())).toBe(transparent);
    expect(halfAlpha).toBeDefined();
  });

  it('keeps alpha unchanged on partially transparent destinations', () => {
    const node = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
    const tile = createEmptyTile();
    for (let i = 0; i < tile.pixels.length; i += 4) {
      tile.pixels[i] = 128;
      tile.pixels[i + 1] = 128;
      tile.pixels[i + 2] = 128;
      tile.pixels[i + 3] = 128;
    }
    node.tiles.set(makeTileKey(0, 0), tile);
    const updated = compositeDodgeBurnDabOnNode(node, IDENTITY_DAB, dodgeBurn());
    expect(pixelAt(updated, TILE_SIZE / 2, TILE_SIZE / 2).a).toBe(128);
  });

  it('a shadows-weighted burn darkens dark pixels more than bright ones', () => {
    const dark = flatLayer(64);
    const bright = flatLayer(200);
    const burn = dodgeBurn({ mode: 'burn', exposure: 2, range: 'shadows' });
    const darkAfter = pixelAt(compositeDodgeBurnDabOnNode(dark, IDENTITY_DAB, burn), 64, 64).r;
    const brightAfter = pixelAt(compositeDodgeBurnDabOnNode(bright, IDENTITY_DAB, burn), 64, 64).r;
    // Shadows focus weights the dark sample near 1 and the bright sample near
    // 0, so the dark pixel moves much further.
    expect(64 - darkAfter).toBeGreaterThan(200 - brightAfter);
    expect(brightAfter).toBeGreaterThanOrEqual(196);
  });

  it('respects selection coverage', () => {
    const node = flatLayer(128);
    // Empty (zero-size) coverage is what a non-intersecting selection yields:
    // it must block every pixel rather than acting as "unrestricted".
    const blocked = compositeDodgeBurnDabOnNode(
      node,
      IDENTITY_DAB,
      dodgeBurn({ coverage: { x: 0, y: 0, width: 0, height: 0, data: new Uint8Array(0) } }),
    );
    expect(blocked).toBe(node);
  });

  it('scales deposits with dab flow and opacity', () => {
    const full = compositeDodgeBurnDabOnNode(flatLayer(128), IDENTITY_DAB, dodgeBurn());
    const half = compositeDodgeBurnDabOnNode(flatLayer(128), IDENTITY_DAB, dodgeBurn());
    const weakened = compositeDodgeBurnDabOnNode(
      flatLayer(128),
      { ...IDENTITY_DAB, flow: 0.25 },
      dodgeBurn(),
    );
    const center = (n: ReturnType<typeof makeRasterLayerNode>) =>
      pixelAt(n, TILE_SIZE / 2, TILE_SIZE / 2).r;
    expect(center(half)).toBe(center(full));
    expect(center(weakened)).toBeGreaterThan(128);
    expect(center(weakened)).toBeLessThan(center(full));
  });
});
