/**
 * Pattern repeat geometry — the single source of truth for how a pattern tile
 * is placed on its repetition lattice.
 *
 * ## Why this module exists
 *
 * Before this contract, every consumer invented its own tiling loop:
 * `paintFill` in the engine walked `startX = x + floor(...) * stepX`, the
 * Rust print backend walked `x_step = tile_w + spacing`, and the Inspector
 * preview showed exactly one tile. "Half-drop", independent horizontal and
 * vertical gaps, an authored phase, and mirroring had no representation at
 * all, so a designer could not describe the arrangement they were looking at.
 *
 * One evaluator, shared by preview, fill rendering, hit testing, and export,
 * removes that class of drift: `p(i, j) = phase + i·u + j·v`, where `u` is the
 * column step and `v` the row step. Half-drop offsets columns vertically;
 * brick offsets rows horizontally. The two basis vectors stay explicit so
 * these arrangements cannot collapse to the same shear.
 *
 * ## Coordinate space
 *
 * Pattern space is the 2-D plane the pattern is defined in. For an object-space
 * fill it is the object's local coordinate space; for a document-space fill it
 * is the page. Nothing here is scale- or camera-dependent — a camera pan or
 * zoom must never change an authored phase.
 *
 * A tile copy's local content coordinates run `x ∈ [0, tileWidth]`,
 * `y ∈ [0, tileHeight]`. {@link patternInstanceMatrix} maps those to pattern
 * space. A flipped instance maps to the same axis-aligned box, mirrored about
 * its own centre.
 *
 * ## Research basis
 *
 * - SVG `<pattern>` `patternUnits` / `patternContentUnits` / `patternTransform`
 *   (MDN; SVG 1.1 §13.3) — a pattern tile is defined in its own coordinate
 *   system and repeated by a transform; a half-drop repeat is a shear.
 * - Adobe Illustrator "Create and apply patterns" — tile vs. art bounds,
 *   independent pattern transforms, and shared-swatch editing.
 * - Print/packaging convention for brick and half-drop setts.
 *
 * Non-negotiables encoded here:
 * - Reject non-finite / zero / negative tile dimensions and non-positive
 *   repeat periods instead of silently producing an empty or runaway fill.
 * - Keep fractional values and negative origins; never round a cell position
 *   independently, so no drift accumulates across a large repeat.
 * - Bound the instance count for a destination so a tiny period cannot launch
 *   an unbounded loop.
 */

import type { Affine } from './affine';

/** The lattice arrangement of a pattern repeat. */
export type PatternArrangement = 'grid' | 'half-drop' | 'brick';

/** Arrangement values in UI order. */
export const PATTERN_ARRANGEMENTS: readonly PatternArrangement[] = [
  'grid',
  'half-drop',
  'brick',
] as const;

/** Human-readable arrangement labels (single-sourced for the Inspector). */
export const PATTERN_ARRANGEMENT_LABELS: Record<PatternArrangement, string> = {
  grid: 'Grid',
  'half-drop': 'Half-drop',
  brick: 'Brick',
};

/**
 * Parameters of a pattern repeat. All lengths are in px of pattern space.
 *
 * `gapX`/`gapY` are the empty space between neighbouring tiles along each
 * axis. The legacy single `spacing` value maps to `gapX = gapY = spacing`.
 */
export interface PatternRepeatParams {
  /** Logical tile width. Must be finite and > 0. */
  tileWidth: number;
  /** Logical tile height. Must be finite and > 0. */
  tileHeight: number;
  /** Horizontal gap between columns. Default 0. */
  gapX?: number;
  /** Vertical gap between rows. Default 0. */
  gapY?: number;
  /** Lattice arrangement. Default `'grid'`. */
  arrangement?: PatternArrangement;
  /** Horizontal displacement of odd rows as a fraction of the column step. */
  rowShift?: number;
  /** Vertical displacement of odd columns as a fraction of the row step. */
  columnShift?: number;
  /** Flip alternating columns horizontally. Default false. */
  mirrorX?: boolean;
  /** Flip alternating rows vertically. Default false. */
  mirrorY?: boolean;
  /** Authored phase offset in px. Default 0. Fractional and negative allowed. */
  offsetX?: number;
  offsetY?: number;
}

/** A resolved, validated repeat lattice. */
export interface PatternLattice {
  /** Column step vector `u = (ux, uy)`. */
  ux: number;
  uy: number;
  /** Row step vector `v = (vx, vy)`. */
  vx: number;
  vy: number;
  /** Phase (origin of tile `(0, 0)`). */
  phaseX: number;
  phaseY: number;
  /** Tile dimensions the lattice was resolved from. */
  tileWidth: number;
  tileHeight: number;
  /** Whether alternating columns / rows are flipped. */
  mirrorX: boolean;
  mirrorY: boolean;
}

/** An axis-aligned rectangle in pattern space (`x`,`y` = top-left). */
export interface PatternRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Inclusive lattice index bounds covering a destination rect. */
export interface PatternIndexRange {
  iMin: number;
  iMax: number;
  jMin: number;
  jMax: number;
}

/** Result of a bounded instance walk. */
export interface PatternInstanceWalk {
  /** Instances visited. */
  count: number;
  /** True when {@link forEachPatternInstance}'s cap stopped the walk early. */
  truncated: boolean;
}

/** Default cap on instances enumerated for one destination rect. */
export const PATTERN_MAX_INSTANCES = 20000;

/** Hard ceilings keep an authored lattice away from numerical singularity. */
export const PATTERN_MAX_ROW_SHIFT = 8;
export const PATTERN_MAX_COLUMN_SHIFT = 8;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Resolve the effective row shift for an arrangement.
 * An explicit `rowShift` wins; otherwise half-drop and brick shift by half.
 */
export function resolveRowShift(params: PatternRepeatParams): number {
  if (isFiniteNumber(params.rowShift)) {
    return Math.max(-PATTERN_MAX_ROW_SHIFT, Math.min(PATTERN_MAX_ROW_SHIFT, params.rowShift));
  }
  return params.arrangement === 'brick' ? 0.5 : 0;
}

/** Resolve the vertical stagger of columns for half-drop arrangements. */
export function resolveColumnShift(params: PatternRepeatParams): number {
  if (isFiniteNumber(params.columnShift)) {
    return Math.max(
      -PATTERN_MAX_COLUMN_SHIFT,
      Math.min(PATTERN_MAX_COLUMN_SHIFT, params.columnShift),
    );
  }
  return params.arrangement === 'half-drop' ? 0.5 : 0;
}

/**
 * Build a validated lattice, or `null` when the parameters are unusable.
 *
 * Returns `null` for non-finite tile sizes, non-positive tile dimensions, or a
 * non-positive column/row step (which would otherwise tile forever or never
 * advance). Callers are expected to render a typed fallback rather than loop.
 */
export function resolvePatternLattice(params: PatternRepeatParams): PatternLattice | null {
  const tileWidth = params.tileWidth;
  const tileHeight = params.tileHeight;
  if (!isFiniteNumber(tileWidth) || !isFiniteNumber(tileHeight)) return null;
  if (tileWidth <= 0 || tileHeight <= 0) return null;

  const gapX = isFiniteNumber(params.gapX) ? params.gapX : 0;
  const gapY = isFiniteNumber(params.gapY) ? params.gapY : 0;

  const stepX = tileWidth + gapX;
  const stepY = tileHeight + gapY;
  // A non-positive period trades overlap for a runaway loop; reject it.
  if (!Number.isFinite(stepX) || !Number.isFinite(stepY) || stepX <= 0 || stepY <= 0) return null;

  const rowShift = resolveRowShift(params);
  const columnShift = resolveColumnShift(params);
  const vx = rowShift * stepX;
  const uy = columnShift * stepY;
  const determinant = stepX * stepY - vx * uy;
  if (![vx, uy, determinant].every(Number.isFinite) || Math.abs(determinant) < 1e-12) return null;

  const offsetX = isFiniteNumber(params.offsetX) ? params.offsetX : 0;
  const offsetY = isFiniteNumber(params.offsetY) ? params.offsetY : 0;

  return {
    ux: stepX,
    uy,
    vx,
    vy: stepY,
    phaseX: offsetX,
    phaseY: offsetY,
    tileWidth,
    tileHeight,
    mirrorX: params.mirrorX === true,
    mirrorY: params.mirrorY === true,
  };
}

/**
 * The affine mapping tile-local content coordinates to pattern space for
 * lattice index `(i, j)`.
 *
 * For a translational lattice this is `p = phase + i·u + j·v`. When an axis is
 * mirrored, odd indices on that axis flip about the tile's own centre, so the
 * copy still occupies `[p, p + tile]` on that axis.
 */
export function patternInstanceMatrix(lattice: PatternLattice, i: number, j: number): Affine {
  const px = lattice.phaseX + i * lattice.ux + j * lattice.vx;
  const py = lattice.phaseY + i * lattice.uy + j * lattice.vy;

  const flipX = lattice.mirrorX && mod2(i) !== 0;
  const flipY = lattice.mirrorY && mod2(j) !== 0;

  const a = flipX ? -1 : 1;
  const d = flipY ? -1 : 1;
  const e = px + (flipX ? lattice.tileWidth : 0);
  const f = py + (flipY ? lattice.tileHeight : 0);
  return [a, 0, 0, d, e, f];
}

/** Non-negative parity (`%` in JS keeps the sign of the dividend). */
function mod2(n: number): number {
  return ((n % 2) + 2) % 2;
}

/**
 * The axis-aligned box a tile copy occupies in pattern space. Independent of
 * mirroring (a flip keeps the same box).
 */
export function patternInstanceBounds(lattice: PatternLattice, i: number, j: number): PatternRect {
  return {
    x: lattice.phaseX + i * lattice.ux + j * lattice.vx,
    y: lattice.phaseY + i * lattice.uy + j * lattice.vy,
    w: lattice.tileWidth,
    h: lattice.tileHeight,
  };
}

/**
 * Conservative lattice index bounds whose copies may intersect `rect`,
 * padded by `bleed` px on every side. Inverting the full two-vector basis
 * handles both column-offset half-drop and row-offset brick layouts.
 *
 * `bleed` is the outward influence of the tile content — blur radius, shadow
 * spread, or artwork that overflows the tile. It is *not* a fudge factor for
 * filtering; the renderer's own sampling handles that. Callers that know the
 * influence bounds should pass them so motifs larger than one tile keep
 * contributing across the cell seam.
 */
export function patternIndexRange(
  lattice: PatternLattice,
  rect: PatternRect,
  bleed = 0,
): PatternIndexRange | null {
  const x0 = rect.x - bleed;
  const y0 = rect.y - bleed;
  const x1 = rect.x + rect.w + bleed;
  const y1 = rect.y + rect.h + bleed;
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;

  // A rectangular copy intersects only when its origin lies within the
  // destination expanded by the copy's width and height. Inverse-map the
  // expanded rectangle's corners through the full lattice basis. One extra
  // floor/ceil retain boundary-touching cells; the renderer's clipping removes
  // copies that only touch an edge.
  const determinant = lattice.ux * lattice.vy - lattice.vx * lattice.uy;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const corners: Array<[number, number]> = [
    [x0 - lattice.tileWidth, y0 - lattice.tileHeight],
    [x1, y0 - lattice.tileHeight],
    [x1, y1],
    [x0 - lattice.tileWidth, y1],
  ];
  const indices = corners.map(([x, y]) => {
    const dx = x - lattice.phaseX;
    const dy = y - lattice.phaseY;
    return [
      (dx * lattice.vy - dy * lattice.vx) / determinant,
      (dy * lattice.ux - dx * lattice.uy) / determinant,
    ] as const;
  });
  if (indices.some(([i, j]) => !Number.isFinite(i) || !Number.isFinite(j))) return null;
  const iMin = Math.floor(Math.min(...indices.map(([i]) => i)) + 1e-12) + 1;
  const iMax = Math.ceil(Math.max(...indices.map(([i]) => i)) - 1e-12) - 1;
  const jMin = Math.floor(Math.min(...indices.map(([, j]) => j)) + 1e-12) + 1;
  const jMax = Math.ceil(Math.max(...indices.map(([, j]) => j)) - 1e-12) - 1;
  if (![iMin, iMax, jMin, jMax].every(Number.isSafeInteger)) return null;
  return { iMin, iMax, jMin, jMax };
}

/**
 * Visit every tile copy intersecting `rect` (padded by `bleed`), in row-major
 * order, passing the lattice index and the instance matrix.
 *
 * Bounded by `maxInstances` so a tiny period over a huge destination cannot
 * launch an unbounded loop. Returns the visited count and whether the walk was
 * truncated. Callers must not treat a truncated walk as complete output.
 */
export function forEachPatternInstance(
  lattice: PatternLattice,
  rect: PatternRect,
  visit: (i: number, j: number, matrix: Affine) => void,
  options: { bleed?: number; maxInstances?: number } = {},
): PatternInstanceWalk {
  const range = patternIndexRange(lattice, rect, options.bleed ?? 0);
  if (!range) return { count: 0, truncated: false };
  const cap = options.maxInstances ?? PATTERN_MAX_INSTANCES;

  let count = 0;
  for (let j = range.jMin; j <= range.jMax; j++) {
    for (let i = range.iMin; i <= range.iMax; i++) {
      if (count >= cap) return { count, truncated: true };
      visit(i, j, patternInstanceMatrix(lattice, i, j));
      count++;
    }
  }
  return { count, truncated: false };
}

/** A hit against the repeat lattice. */
export interface PatternCellHit {
  /** Lattice index of the containing cell. */
  i: number;
  j: number;
  /**
   * The point mapped back into the source tile's local coordinates, in
   * `[0, tileWidth] × [0, tileHeight]`. Mirroring is undone, so a painter can
   * address the canonical source pixel.
   */
  localX: number;
  localY: number;
}

/**
 * Map a point in pattern space to the canonical source tile coordinates of the
 * cell that contains it. This is the inverse of {@link patternInstanceMatrix}
 * and is what makes cross-boundary editing address the one real motif instead
 * of a ghost copy.
 */
export function patternCellAt(
  lattice: PatternLattice,
  x: number,
  y: number,
): PatternCellHit | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const determinant = lattice.ux * lattice.vy - lattice.vx * lattice.uy;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const dx = x - lattice.phaseX;
  const dy = y - lattice.phaseY;
  const baseI = (dx * lattice.vy - dy * lattice.vx) / determinant;
  const baseJ = (dy * lattice.ux - dx * lattice.uy) / determinant;
  if (![baseI, baseJ].every(Number.isFinite)) return null;

  // Overlap can make multiple copies contain a point. Prefer the cell whose
  // lattice coordinates own it, then check nearby copies for negative-gap
  // overlap. Points in real gaps return null.
  const startI = Math.floor(baseI);
  const startJ = Math.floor(baseJ);
  const candidates: Array<{ i: number; j: number; localX: number; localY: number }> = [];
  for (let j = startJ - 1; j <= startJ + 1; j++) {
    for (let i = startI - 1; i <= startI + 1; i++) {
      const matrix = patternInstanceMatrix(lattice, i, j);
      const local = applyInverse(matrix, x, y);
      if (
        local.localX >= 0 &&
        local.localX <= lattice.tileWidth &&
        local.localY >= 0 &&
        local.localY <= lattice.tileHeight
      ) {
        candidates.push({ i, j, ...local });
      }
    }
  }
  candidates.sort((a, b) => {
    const da = (a.i - baseI) ** 2 + (a.j - baseJ) ** 2;
    const db = (b.i - baseI) ** 2 + (b.j - baseJ) ** 2;
    return da - db || a.j - b.j || a.i - b.i;
  });
  return candidates[0] ?? null;
}

function applyInverse(matrix: Affine, x: number, y: number): { localX: number; localY: number } {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (det === 0 || !Number.isFinite(det)) return { localX: Number.NaN, localY: Number.NaN };
  const px = x - e;
  const py = y - f;
  return {
    localX: (d * px - c * py) / det,
    localY: (a * py - b * px) / det,
  };
}

/**
 * A stable signature of the repeat parameters, for cache keys. Includes every
 * input the lattice actually depends on so two fills with different
 * arrangements can never share a resolved repeat.
 */
export function patternRepeatSignature(params: PatternRepeatParams): string {
  const lattice = resolvePatternLattice(params);
  if (!lattice) return 'degenerate';
  return [
    lattice.tileWidth,
    lattice.tileHeight,
    lattice.ux,
    lattice.uy,
    lattice.vy,
    lattice.vx,
    lattice.phaseX,
    lattice.phaseY,
    lattice.mirrorX ? 'mx' : '',
    lattice.mirrorY ? 'my' : '',
  ].join('|');
}
