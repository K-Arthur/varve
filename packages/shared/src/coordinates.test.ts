import { describe, expect, it } from 'vitest';
import {
  artboardToWorld,
  formatCoordForRuler,
  getArtboardRulerOrigin,
  worldToArtboard,
} from './coordinates';

const artboard = { x: 100, y: 200, w: 800, h: 600 };

describe('worldToArtboard / artboardToWorld', () => {
  it('converts world to artboard-local', () => {
    expect(worldToArtboard([150, 250], artboard)).toEqual([50, 50]);
  });

  it('round-trips', () => {
    const local: [number, number] = [42, 88];
    const world = artboardToWorld(local, artboard);
    expect(worldToArtboard(world, artboard)).toEqual(local);
  });
});

describe('getArtboardRulerOrigin', () => {
  it('defaults to artboard top-left', () => {
    expect(getArtboardRulerOrigin(artboard)).toEqual([100, 200]);
  });

  it('applies optional per-page offset', () => {
    expect(getArtboardRulerOrigin(artboard, [10, 20])).toEqual([110, 220]);
  });
});

describe('formatCoordForRuler', () => {
  it('returns world value in global mode', () => {
    expect(formatCoordForRuler(150, 'x', 'global', artboard)).toBe(150);
  });

  it('returns artboard-relative value in artboard mode', () => {
    expect(formatCoordForRuler(150, 'x', 'artboard', artboard)).toBe(50);
    expect(formatCoordForRuler(250, 'y', 'artboard', artboard)).toBe(50);
  });
});
