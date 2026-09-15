import { createEmptyTile, makeTileKey, TILE_SIZE } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  composeRetouchSample,
  layersForSamplingScope,
  type RasterSamplingLayer,
} from '../retouchSampling';

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

function solidTile(r: number, g: number, b: number, a = 255) {
  const tile = createEmptyTile();
  for (let index = 0; index < tile.pixels.length; index += 4) {
    tile.pixels[index] = r;
    tile.pixels[index + 1] = g;
    tile.pixels[index + 2] = b;
    tile.pixels[index + 3] = a;
  }
  return tile;
}

function splitTile() {
  const tile = createEmptyTile();
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const index = (y * TILE_SIZE + x) * 4;
      const left = x < TILE_SIZE / 2;
      tile.pixels[index] = left ? 255 : 0;
      tile.pixels[index + 1] = 0;
      tile.pixels[index + 2] = left ? 0 : 255;
      tile.pixels[index + 3] = 255;
    }
  }
  return tile;
}

function layer(
  id: string,
  tile: ReturnType<typeof solidTile>,
  overrides: Partial<RasterSamplingLayer> = {},
): RasterSamplingLayer {
  return {
    id,
    tiles: new Map([[makeTileKey(0, 0), tile]]),
    opacity: 1,
    visible: true,
    blendMode: 'normal',
    transform: IDENTITY,
    ...overrides,
  };
}

function sampleAt(tiles: Map<string, ReturnType<typeof solidTile>>, x: number, y: number) {
  const tile = tiles.get(makeTileKey(0, 0));
  if (!tile) return null;
  const index = (y * TILE_SIZE + x) * 4;
  return {
    r: tile.pixels[index]!,
    g: tile.pixels[index + 1]!,
    b: tile.pixels[index + 2]!,
    a: tile.pixels[index + 3]!,
  };
}

function compose(layers: RasterSamplingLayer[]) {
  return composeRetouchSample({
    targetTransform: IDENTITY,
    targetWidth: TILE_SIZE,
    targetHeight: TILE_SIZE,
    layers,
  });
}

describe('layersForSamplingScope', () => {
  const bottom = layer('bottom', solidTile(255, 0, 0));
  const target = layer('target', solidTile(0, 255, 0));
  const top = layer('top', solidTile(0, 0, 255));
  const ordered = [bottom, target, top];

  it('current samples only the target', () => {
    expect(layersForSamplingScope(ordered, 'target', 'current').map((item) => item.id)).toEqual([
      'target',
    ]);
  });

  it('below includes the target and everything under it', () => {
    expect(layersForSamplingScope(ordered, 'target', 'below').map((item) => item.id)).toEqual([
      'bottom',
      'target',
    ]);
  });

  it('allVisible keeps the full paint order', () => {
    expect(layersForSamplingScope(ordered, 'target', 'allVisible').map((item) => item.id)).toEqual([
      'bottom',
      'target',
      'top',
    ]);
  });

  it('returns nothing when the target is outside the active scope', () => {
    expect(layersForSamplingScope(ordered, 'missing', 'below')).toEqual([]);
  });
});

describe('composeRetouchSample', () => {
  it('honours paint order so lower layers are covered by upper ones', () => {
    const red = layer('red', solidTile(255, 0, 0));
    const blue = layer('blue', solidTile(0, 0, 255));
    expect(sampleAt(compose([red, blue]).tiles, 10, 10)).toMatchObject({
      r: 0,
      g: 0,
      b: 255,
    });
  });

  it('applies layer opacity once on the first contributor', () => {
    const red = layer('red', solidTile(255, 0, 0), { opacity: 0.5 });
    expect(sampleAt(compose([red]).tiles, 10, 10)).toMatchObject({
      r: 255,
      a: 128,
    });
  });

  it('composites non-normal blend modes instead of treating them as normal', () => {
    const backdrop = layer('backdrop', solidTile(128, 128, 128));
    const multiply = layer('multiply', solidTile(128, 128, 128), { blendMode: 'multiply' });
    const sampled = sampleAt(compose([backdrop, multiply]).tiles, 10, 10)!;
    // Multiply of 0.5 backdrop and 0.5 source is 0.25, not source-over 0.5.
    expect(sampled.r).toBe(64);
    expect(sampled.g).toBe(64);
    expect(sampled.b).toBe(64);
  });

  it('maps a translated layer into the target local space', () => {
    const translated: Affine = [1, 0, 0, 1, 30, 0];
    const shifted = layer('shifted', splitTile(), { transform: translated });
    const composed = compose([shifted]).tiles;
    // Target x=40 is layer x=10 (red half); target x=100 is layer x=70 (blue).
    expect(sampleAt(composed, 40, 10)).toMatchObject({ r: 255, b: 0 });
    expect(sampleAt(composed, 100, 10)).toMatchObject({ r: 0, b: 255 });
  });

  it('never aliases a contributing layer tile into the sample', () => {
    const source = solidTile(10, 20, 30);
    const composed = compose([layer('source', source)]).tiles;
    const sample = composed.get(makeTileKey(0, 0))!;
    expect(sample.pixels).not.toBe(source.pixels);
    sample.pixels[0] = 250;
    expect(source.pixels[0]).toBe(10);
  });

  it('skips hidden layers and hidden content', () => {
    const hidden = layer('hidden', solidTile(255, 0, 0), { visible: false });
    expect(compose([hidden]).tiles.size).toBe(0);
  });
});
