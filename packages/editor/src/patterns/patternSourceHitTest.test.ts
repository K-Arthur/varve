import { patternInstanceMatrix, resolvePatternLattice } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { hitTestPatternSourceMotifs } from './patternSourceHitTest';

describe('pattern source motif hit testing', () => {
  it('maps a repeated neighbor back to one canonical motif, including negative indices', () => {
    const lattice = resolvePatternLattice({ tileWidth: 100, tileHeight: 80 });
    if (!lattice) throw new Error('expected a valid grid lattice');
    const motifs = [{ id: 'leaf', x: 0, y: 0, w: 20, h: 20, order: 0 }];

    expect(hitTestPatternSourceMotifs(lattice, 105, 5, motifs)).toMatchObject({
      id: 'leaf',
      i: 1,
      j: 0,
      localX: 5,
      localY: 5,
    });
    expect(hitTestPatternSourceMotifs(lattice, -95, 5, motifs)).toMatchObject({
      id: 'leaf',
      i: -1,
      j: 0,
      localX: 5,
      localY: 5,
    });
  });

  it('uses half-drop geometry and mirror parity when mapping the clicked copy', () => {
    const lattice = resolvePatternLattice({
      tileWidth: 100,
      tileHeight: 80,
      arrangement: 'half-drop',
      mirrorX: true,
    });
    if (!lattice) throw new Error('expected a valid half-drop lattice');
    const matrix = patternInstanceMatrix(lattice, 1, -1);
    const pointX = matrix[0] * 15 + matrix[4];
    const pointY = matrix[3] * 25 + matrix[5];

    expect(
      hitTestPatternSourceMotifs(lattice, pointX, pointY, [
        { id: 'leaf', x: 10, y: 20, w: 10, h: 10, order: 0 },
      ]),
    ).toMatchObject({ id: 'leaf', i: 1, j: -1, localX: 15, localY: 25 });
  });

  it('finds artwork overhanging the tile edge without treating the ghost as a new motif', () => {
    const lattice = resolvePatternLattice({ tileWidth: 100, tileHeight: 80 });
    if (!lattice) throw new Error('expected a valid grid lattice');

    expect(
      hitTestPatternSourceMotifs(lattice, 95, 5, [
        { id: 'wide-leaf', x: -12, y: 0, w: 24, h: 20, order: 0 },
      ]),
    ).toMatchObject({ id: 'wide-leaf', i: 1, j: 0, localX: -5, localY: 5 });
  });
});
