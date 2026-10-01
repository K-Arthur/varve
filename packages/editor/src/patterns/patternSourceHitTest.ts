import { type PatternLattice, patternIndexRange, patternInstanceMatrix } from '@varve/shared';

export interface PatternSourceMotifBounds {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Paint order in the source mini-scene. */
  order: number;
}

export interface PatternSourceMotifHit {
  id: string;
  i: number;
  j: number;
  localX: number;
  localY: number;
}

const MAX_SOURCE_HIT_CANDIDATES = 4096;

/** Map a point in any repeat copy back to the topmost canonical source motif. */
export function hitTestPatternSourceMotifs(
  lattice: PatternLattice,
  x: number,
  y: number,
  motifs: readonly PatternSourceMotifBounds[],
): PatternSourceMotifHit | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || motifs.length === 0) return null;
  const bleed = sourceFootprintOverflow(lattice, motifs);
  const range = patternIndexRange(lattice, { x, y, w: 0, h: 0 }, bleed);
  if (!range) return null;
  const candidateCount = (range.iMax - range.iMin + 1) * (range.jMax - range.jMin + 1);
  if (!Number.isSafeInteger(candidateCount) || candidateCount > MAX_SOURCE_HIT_CANDIDATES) {
    return null;
  }

  let hit: PatternSourceMotifHit | null = null;
  let hitOrder = -Infinity;
  for (let j = range.jMin; j <= range.jMax; j += 1) {
    for (let i = range.iMin; i <= range.iMax; i += 1) {
      const matrix = patternInstanceMatrix(lattice, i, j);
      const localX = (x - matrix[4]) / matrix[0];
      const localY = (y - matrix[5]) / matrix[3];
      for (const motif of motifs) {
        if (
          localX >= motif.x &&
          localX <= motif.x + motif.w &&
          localY >= motif.y &&
          localY <= motif.y + motif.h &&
          Number.isFinite(motif.order)
        ) {
          // Match the preview's row-major cells and source-node paint order:
          // later painted copies and roots win when their bounds overlap.
          if (
            !hit ||
            j > hit.j ||
            (j === hit.j && i > hit.i) ||
            (j === hit.j && i === hit.i && motif.order >= hitOrder)
          ) {
            hit = { id: motif.id, i, j, localX, localY };
            hitOrder = motif.order;
          }
        }
      }
    }
  }
  return hit;
}

function sourceFootprintOverflow(
  lattice: PatternLattice,
  motifs: readonly PatternSourceMotifBounds[],
): number {
  let bleed = 0;
  for (const motif of motifs) {
    bleed = Math.max(
      bleed,
      -motif.x,
      motif.x + motif.w - lattice.tileWidth,
      -motif.y,
      motif.y + motif.h - lattice.tileHeight,
    );
  }
  return Math.max(0, bleed);
}
