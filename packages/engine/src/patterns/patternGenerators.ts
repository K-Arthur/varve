/**
 * Procedural pattern generators — deterministic, worker-safe, and genuinely
 * periodic.
 *
 * ## Why this module was rewritten (2026-09-30)
 *
 * The previous implementation produced *a* square of pixels for each preset but
 * not a repeat: polka dots were placed at uniformly random positions and
 * clipped at the tile edge, so tiling them showed hard cuts and doubled edge
 * dots; `crosshatch` drew a fan of non-parallel lines (`lineTo(i + size,
 * size - i)`); `hex-grid` used an irrational hex period that no square tile can
 * reproduce; and `seed ? seededRandom(seed) : Math.random` made seed `0`
 * silently non-deterministic.
 *
 * Every generator is now defined as a **pure periodic field** `f(x, y)` over
 * the tile `[0, W) × [0, H)`, and the tile is produced by sampling that field.
 * Periodicity is therefore a property of the mathematics, not of the drawing
 * calls, and it is testable without a canvas (see
 * `patternGenerators.field.test.ts`).
 *
 * ## What "seamless" means here
 *
 * For a tile `(W, H)`, the field satisfies `f(x + W, y) = f(x, y)` and
 * `f(x, y + H) = f(x, y)` for every sample. Repeating the raster therefore
 * reproduces the field exactly (up to raster sampling), which is what makes a
 * repeat repeat. This is *not* a claim that an arbitrary imported photo becomes
 * seamless by repetition; that needs seam inspection and edge editing, which is
 * a separate workflow.
 *
 * ## Constrained angles
 *
 * A stripe field of slope `m/k` is periodic on a `W × H` tile only when
 * `W·cosθ` and `H·sinθ` are both integer multiples of the half-period. Rather
 * than draw an arbitrary angle and pretend, {@link resolveStripeAngle} snaps to
 * the nearest angle that *does* close on the tile and reports the substitution
 * in `warnings` and `effectiveAngle`. The caller still has the fill's own
 * `rotation` for an exact arbitrary direction, which rotates the whole repeat
 * lattice instead of breaking the tile.
 */

import { cssStringToManagedColor } from '@varve/shared';

export type PatternType = 'checkerboard' | 'stripes' | 'polka-dots' | 'crosshatch' | 'hex-grid';

/** Pattern types in UI order. */
export const PATTERN_TYPES: readonly PatternType[] = [
  'checkerboard',
  'stripes',
  'polka-dots',
  'crosshatch',
  'hex-grid',
] as const;

export const PATTERN_TYPE_LABELS: Record<PatternType, string> = {
  checkerboard: 'Checkerboard',
  stripes: 'Stripes',
  'polka-dots': 'Dots',
  crosshatch: 'Crosshatch',
  'hex-grid': 'Hex grid',
};

/**
 * Resource budget for a generated tile.
 *
 * These replace the previous unexplained 8–256 clamp: a minimum legible size,
 * a per-axis ceiling, and a total pixel budget. A request above the budget is
 * scaled down proportionally (reported as a warning) rather than silently
 * clamped on one axis only, which used to distort the tile.
 */
export const PATTERN_TILE_MIN = 8;
export const PATTERN_TILE_MAX = 1024;
export const PATTERN_TILE_AREA_BUDGET = 1_048_576; // 1 MP

export interface PatternOptions {
  /** Square tile size. Used for both axes unless `tileWidth`/`tileHeight` are set. */
  tileSize: number;
  /** Explicit tile width (overrides `tileSize`). */
  tileWidth?: number;
  /** Explicit tile height (overrides `tileSize`). */
  tileHeight?: number;
  color1: string;
  color2: string;
  /** Deterministic seed. Any finite number, including `0`, is honoured. */
  seed?: number;
  /** For stripes: band angle in degrees. Constrained to a tile-closing angle. */
  angle?: number;
  /** For dots/crosshatch: density 0–1. */
  density?: number;
  /** For hex-grid: gap between hexagons, in px. */
  gap?: number;
}

/** An RGBA sample, each channel 0–255. */
export type Rgba = readonly [number, number, number, number];

/** A pure periodic field. `sample` accepts any real (x, y), including negatives. */
export interface PatternField {
  width: number;
  height: number;
  sample(x: number, y: number): Rgba;
  /** The angle actually used after constraint (stripes); otherwise the request. */
  effectiveAngle: number;
  /** Notes when a requested value was constrained or scaled. */
  warnings: string[];
  /**
   * The analytically expected mean coverage (0–1) of `color2` over one tile.
   *
   * This is the motif geometry written down independently of the sampling code:
   * a checkerboard is half inked, a dot lattice is `count · πr² / (W·H)`, a hex
   * lattice is four hexagons of area `3ab` per period. A generator that clips a
   * motif at the tile edge cannot hit it, which is exactly the bug this field
   * exists to catch. Tests integrate `sample` and compare.
   */
  expectedInkFraction: number;
}

/** A generated tile plus the geometry a fill must use to repeat it. */
export interface PatternTile {
  dataUrl: string;
  width: number;
  height: number;
  effectiveAngle: number;
  warnings: string[];
}

// ── Deterministic PRNG ────────────────────────────────────────────────

/**
 * Avalanche a seed into a well-distributed 32-bit state.
 *
 * The old generator used the raw seed in an LCG, so small or zero seeds
 * produced degenerate, highly correlated output — and `seed ? … : Math.random`
 * excluded `0` from the deterministic path entirely.
 */
function mixSeed(seed: number): number {
  let h = Math.floor(seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * Documented policy: any finite `seed` (including `0` and negatives) maps to a
 * deterministic stream via {@link mixSeed}. There is no seed value that falls
 * back to `Math.random`.
 */
export function seededRandom(seed: number): () => number {
  let a = mixSeed(seed);
  if (a === 0) a = 0x9e3779b9; // guard: mixSeed(0) is 0, keep the stream nonzero
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fresh seed for the "Randomize" action. The caller persists the returned
 * value in the pattern recipe; the generator itself never rolls a seed.
 */
export function randomPatternSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// ── Color helpers ─────────────────────────────────────────────────────

const FALLBACK_COLORS: Record<'color1' | 'color2', Rgba> = {
  color1: [255, 255, 255, 255],
  color2: [0, 0, 0, 255],
};

function toRgba(css: string, role: 'color1' | 'color2', warnings: string[]): Rgba {
  const parsed = cssStringToManagedColor(css);
  if (!parsed) {
    warnings.push(`Unrecognized color "${css}" for ${role}; used a neutral default.`);
    return FALLBACK_COLORS[role];
  }
  return [
    Math.round(parsed.r),
    Math.round(parsed.g),
    Math.round(parsed.b),
    Math.round((parsed.a ?? 255) as number),
  ];
}

/** Composite `top` over `bottom` with coverage `cov` (0–1). */
function over(bottom: Rgba, top: Rgba, cov: number): Rgba {
  if (cov <= 0) return bottom;
  const ta = (top[3] / 255) * cov;
  const ba = bottom[3] / 255;
  const oa = ta + ba * (1 - ta);
  if (oa <= 0) return [0, 0, 0, 0];
  const mix = (bc: number, tc: number) => (tc * ta + bc * ba * (1 - ta)) / oa;
  return [
    Math.round(mix(bottom[0], top[0])),
    Math.round(mix(bottom[1], top[1])),
    Math.round(mix(bottom[2], top[2])),
    Math.round(oa * 255),
  ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  // A corrupted or absent persisted numeric field reaches here as NaN (or an
  // infinity), and `NaN < min`/`NaN > max` are both false, so the comparisons
  // below would return NaN and paint an empty tile. Fall back to the minimum.
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/** Positive modulo; negative inputs wrap into `[0, m)`. */
function pmod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

// ── Tile geometry ─────────────────────────────────────────────────────

export interface ResolvedTileSize {
  width: number;
  height: number;
  warnings: string[];
}

/**
 * Resolve and bound a requested tile size. Preserves aspect ratio when the
 * pixel budget is exceeded, and reports both the clamping and the scaling.
 */
export function resolveTileSize(options: PatternOptions): ResolvedTileSize {
  const warnings: string[] = [];
  const rawW = options.tileWidth ?? options.tileSize;
  const rawH = options.tileHeight ?? options.tileSize;
  const finiteW = Number.isFinite(rawW) ? rawW : PATTERN_TILE_MIN;
  const finiteH = Number.isFinite(rawH) ? rawH : PATTERN_TILE_MIN;

  // Scale first so the pixel budget cannot flatten a non-square tile into a
  // square (clamping each axis independently did exactly that).
  let width = finiteW;
  let height = finiteH;
  const scale = Math.min(
    1,
    PATTERN_TILE_MAX / Math.max(width, 1),
    PATTERN_TILE_MAX / Math.max(height, 1),
    Math.sqrt(PATTERN_TILE_AREA_BUDGET / Math.max(width * height, 1)),
  );
  if (scale < 1) {
    width *= scale;
    height *= scale;
    warnings.push(
      `Tile scaled to fit the ${PATTERN_TILE_MAX}px / ${PATTERN_TILE_AREA_BUDGET / 1_000_000} MP budget.`,
    );
  }

  const finalWidth = Math.max(PATTERN_TILE_MIN, Math.round(width));
  const finalHeight = Math.max(PATTERN_TILE_MIN, Math.round(height));
  const area = finalWidth * finalHeight;
  if (area > PATTERN_TILE_AREA_BUDGET) {
    // Rounding up to the floor can push a tiny tile over; trim the long axis.
    return {
      width: finalWidth,
      height: Math.max(PATTERN_TILE_MIN, Math.floor(PATTERN_TILE_AREA_BUDGET / finalWidth)),
      warnings,
    };
  }
  return { width: finalWidth, height: finalHeight, warnings };
}

// ── Stripe angle constraint ───────────────────────────────────────────

export interface StripeAngle {
  /** Closing angle in degrees, in `(0, 180)`, or 0 for exact vertical bands. */
  angle: number;
  /** `true` when the requested angle is reproduced exactly. */
  exact: boolean;
}

/**
 * Find the tile-closing angle nearest to `requestedDeg`.
 *
 * The stripe field is periodic on `(W, H)` when `W·cosθ = k·p` and
 * `H·sinθ = m·p` for integers `k`, `m` (both even, so the alternating colour
 * period divides the tile) and a half-period `p`. That is `tanθ = mW / (kH)`,
 * so candidates are `θ = atan(mW / (kH))` and its mirror.
 */
export function resolveStripeAngle(
  requestedDeg: number,
  width: number,
  height: number,
): StripeAngle {
  const requested = Number.isFinite(requestedDeg) ? pmod(requestedDeg, 180) : 0;
  // Exact axis-aligned bands tile for any integer size.
  if (requested < 0.5 || requested > 179.5) return { angle: 0, exact: true };
  if (Math.abs(requested - 90) < 0.5) return { angle: 90, exact: true };

  let best: StripeAngle = { angle: 0, exact: false };
  let bestError = Number.POSITIVE_INFINITY;
  for (let k = 2; k <= 12; k += 2) {
    for (let m = 2; m <= 12; m += 2) {
      const base = (Math.atan((m * width) / (k * height)) * 180) / Math.PI;
      for (const candidate of [base, 180 - base]) {
        if (candidate < 0.5 || candidate > 179.5) continue;
        const error = Math.abs(candidate - requested);
        if (error < bestError) {
          bestError = error;
          best = { angle: candidate, exact: error < 0.05 };
        }
      }
    }
  }
  return best;
}

// ── Fields ────────────────────────────────────────────────────────────

function checkerboardField(
  width: number,
  height: number,
  c1: Rgba,
  c2: Rgba,
  warnings: string[],
): PatternField {
  const cellW = width / 2;
  const cellH = height / 2;
  return {
    width,
    height,
    effectiveAngle: 0,
    expectedInkFraction: 0.5,
    warnings,
    sample(x, y) {
      const cx = Math.floor(x / cellW);
      const cy = Math.floor(y / cellH);
      return pmod(cx + cy, 2) === 0 ? c1 : c2;
    },
  };
}

function stripesField(
  width: number,
  height: number,
  c1: Rgba,
  c2: Rgba,
  angle: number,
  density: number,
  warnings: string[],
): PatternField {
  const resolved = resolveStripeAngle(angle, width, height);
  if (!resolved.exact) {
    warnings.push(
      `Stripe angle ${pmod(angle, 180).toFixed(1)}° does not close on a ${width}×${height} tile; used ${resolved.angle.toFixed(2)}°. Use pattern rotation for an exact arbitrary angle.`,
    );
  }
  const theta = (resolved.angle * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Pick the half-period. Axis-aligned bands use the perpendicular axis;
  // otherwise the closing (k, m) pair fixes the half-period as `W·cosθ / k`.
  let p = width / 2;
  if (resolved.angle === 90) {
    p = height / 2;
  } else if (resolved.angle !== 0) {
    let bestK = 2;
    let bestErr = Number.POSITIVE_INFINITY;
    for (let k = 2; k <= 12; k += 2) {
      const m = Math.round((k * height * sin) / (width * cos));
      if (m < 2) continue;
      const err = Math.abs(
        (Math.atan((m * width) / (k * height)) * 180) / Math.PI - resolved.angle,
      );
      if (err < bestErr) {
        bestErr = err;
        bestK = k;
      }
    }
    p = (width * cos) / bestK;
  }
  const bandFraction = clamp(density, 0.02, 0.98);
  const halfPeriod = p > 1e-6 ? p : width / 2;
  const period = halfPeriod * 2;
  const bandWidth = halfPeriod * bandFraction;

  return {
    width,
    height,
    effectiveAngle: resolved.angle,
    expectedInkFraction: bandFraction / 2,
    warnings,
    sample(x, y) {
      // Distance along the stripe normal, wrapped onto the period so every
      // lattice translate lands on the same field value.
      const u = pmod(x * cos + y * sin, period);
      // Signed distance to the colour-2 band `[0, bandWidth)`, measured on the
      // circle. Positive inside, negative outside, so both edges antialias.
      const signedDistance =
        u < bandWidth ? Math.min(u, bandWidth - u) : -Math.min(u - bandWidth, period - u);
      return over(c1, c2, smoothstep(-0.5, 0.5, signedDistance));
    },
  };
}

function polkaDotsField(
  width: number,
  height: number,
  c1: Rgba,
  c2: Rgba,
  density: number,
  seed: number | undefined,
  warnings: string[],
): PatternField {
  const densityClamped = clamp(density, 0.02, 0.95);
  // A regular dot lattice: the tile is an exact n × m array of cells, so every
  // cell index is periodic. Dots are jittered *within* their cell and drawn
  // with wrapped neighbour contributions, so an edge dot appears whole on both
  // sides instead of being cut in half.
  const count = clamp(Math.round(densityClamped * 10), 1, 8);
  const cols = Math.max(1, count);
  const rows = Math.max(1, count);
  const cellW = width / cols;
  const cellH = height / rows;
  const radius = Math.min(cellW, cellH) * (0.14 + 0.34 * densityClamped);
  const jitter = 0.22;

  const rng = seed === undefined ? Math.random : seededRandom(seed);
  // Precompute the jitter for every cell of the fundamental domain. Indices are
  // taken modulo (cols, rows), so the field is periodic by construction.
  const jitterX: number[] = [];
  const jitterY: number[] = [];
  for (let i = 0; i < cols * rows; i++) {
    jitterX.push((rng() - 0.5) * 2 * jitter);
    jitterY.push((rng() - 0.5) * 2 * jitter);
  }
  if (seed === undefined && warnings.length === 0) {
    warnings.push('No seed supplied: the dot field is random and will not reproduce.');
  }

  const cellIndex = (i: number, j: number) => pmod(i, cols) * rows + pmod(j, rows);

  return {
    width,
    height,
    effectiveAngle: 0,
    expectedInkFraction: (cols * rows * Math.PI * radius * radius) / (width * height),
    warnings,
    sample(x, y) {
      const bi = Math.floor(x / cellW);
      const bj = Math.floor(y / cellH);
      // Nearest dot may come from any of the 3×3 neighbouring cells. Start at
      // infinity: a large finite start would report full coverage everywhere.
      let best = Number.POSITIVE_INFINITY;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = bi + di;
          const j = bj + dj;
          const idx = cellIndex(i, j);
          const cx = (i + 0.5 + (jitterX[idx] ?? 0)) * cellW;
          const cy = (j + 0.5 + (jitterY[idx] ?? 0)) * cellH;
          const dist = Math.hypot(x - cx, y - cy);
          if (dist < best) best = dist;
        }
      }
      // A 1px antialiasing band centred on the dot edge: the effective area
      // stays πr², which is what `expectedInkFraction` declares.
      const coverage = smoothstep(radius + 0.5, radius - 0.5, best);
      return over(c1, c2, coverage);
    },
  };
}

function crosshatchField(
  width: number,
  height: number,
  c1: Rgba,
  c2: Rgba,
  density: number,
  warnings: string[],
): PatternField {
  const densityClamped = clamp(density, 0.05, 0.95);
  // Both line families are at 45°. A translation preserves the family when its
  // projection on the normal is an integer multiple of the line spacing; using
  // the gcd of the axes as the working period makes the tile exactly periodic
  // even when it is not square.
  const g = Math.max(1, gcd(Math.round(width), Math.round(height)));
  const count = clamp(Math.round(1 + densityClamped * 14), 2, 20);
  const spacing = g / (Math.SQRT2 * count);
  const lineWidth = clamp(spacing * 0.45, 0.75, 3);
  if (width !== height) {
    warnings.push(
      `Crosshatch repeats on a ${g}px square period inside the ${width}×${height} tile.`,
    );
  }

  return {
    width,
    height,
    effectiveAngle: 45,
    expectedInkFraction: 1 - (1 - Math.min(1, lineWidth / spacing)) ** 2,
    warnings,
    sample(x, y) {
      // Distance to the nearest line of each family, wrapped onto the period.
      const du = pmod((y - x) / Math.SQRT2, spacing);
      const dv = pmod((y + x) / Math.SQRT2, spacing);
      const d1 = Math.min(du, spacing - du);
      const d2 = Math.min(dv, spacing - dv);
      const coverage = Math.max(
        smoothstep(lineWidth / 2 + 0.5, lineWidth / 2 - 0.5, d1),
        smoothstep(lineWidth / 2 + 0.5, lineWidth / 2 - 0.5, d2),
      );
      return over(c1, c2, coverage);
    },
  };
}

function hexGridField(
  width: number,
  height: number,
  c1: Rgba,
  c2: Rgba,
  gap: number,
  warnings: string[],
): PatternField {
  // Pointy-top hexagons. A regular hex lattice has an irrational period, which
  // no rectangular tile can reproduce exactly; instead the hexagon *centres*
  // are placed on a lattice whose rectangular period is exactly the tile:
  //   horizontal step W/2 (two columns per period),
  //   vertical step   H/2 (two rows per period),
  // with odd rows offset by W/4. The tile is then genuinely seamless; the
  // hexagons are regular up to the ≤0.5px rounding of the aspect ratio.
  const stepX = width / 2;
  const stepY = height / 2;
  const halfWidth = Math.max(0.5, stepX / 2 - gap / 2);
  const halfHeight = Math.max(0.5, stepY / 1.5 - gap / 2);
  const rowOffset = stepX / 2;
  if (Math.abs(width / height - 2 / Math.sqrt(3)) > 0.02) {
    warnings.push(
      `A regular hex grid needs a height of ${(width * (Math.sqrt(3) / 2)).toFixed(1)}px for a ${width}px width; the ${height}px tile stretches the hexagons but still repeats.`,
    );
  }

  return {
    width,
    height,
    effectiveAngle: 0,
    // Four hexagon centres per period (2 columns × 2 rows), each of area 3ab.
    expectedInkFraction: Math.min(1, (4 * 3 * halfWidth * halfHeight) / (width * height)),
    warnings,
    sample(x, y) {
      const baseRow = Math.floor(y / stepY);
      let coverage = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const row = baseRow + dr;
        const rowShift = pmod(row, 2) === 0 ? 0 : rowOffset;
        const baseCol = Math.floor((x - rowShift) / stepX);
        for (let dc = -1; dc <= 1; dc++) {
          const col = baseCol + dc;
          const cx = col * stepX + rowShift + stepX / 2;
          const cy = row * stepY + stepY / 2;
          const lx = Math.abs(x - cx);
          const ly = Math.abs(y - cy);
          // Stretched pointy-top hexagon: |x|/(2a) + |y|/b <= 1, |y| <= b,
          // |x| <= a. The maximum of the three is a signed pseudo-distance
          // (exact at every vertex), which is all the antialiasing needs.
          const sd = Math.max(
            lx / (2 * halfWidth) + ly / halfHeight - 1,
            ly / halfHeight - 1,
            lx / halfWidth - 1,
          );
          // Convert the normalized violation to px for a consistent 1px AA.
          const px = sd * Math.min(2 * halfWidth, halfHeight);
          coverage = Math.max(coverage, smoothstep(0.5, -0.5, px));
        }
      }
      return over(c1, c2, coverage);
    },
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Build the pure periodic field for a generator. Returns `null` only when the
 * resolved tile size is unusable (which {@link resolveTileSize} already bounds),
 * so callers get a typed failure instead of an empty string.
 */
export function patternField(type: PatternType, options: PatternOptions): PatternField | null {
  const size = resolveTileSize(options);
  const warnings = [...size.warnings];
  if (size.width <= 0 || size.height <= 0) return null;
  const c1 = toRgba(options.color1, 'color1', warnings);
  const c2 = toRgba(options.color2, 'color2', warnings);

  switch (type) {
    case 'checkerboard':
      return checkerboardField(size.width, size.height, c1, c2, warnings);
    case 'stripes':
      return stripesField(
        size.width,
        size.height,
        c1,
        c2,
        options.angle ?? 45,
        options.density ?? 0.5,
        warnings,
      );
    case 'polka-dots':
      return polkaDotsField(
        size.width,
        size.height,
        c1,
        c2,
        options.density ?? 0.3,
        options.seed,
        warnings,
      );
    case 'crosshatch':
      return crosshatchField(size.width, size.height, c1, c2, options.density ?? 0.5, warnings);
    case 'hex-grid':
      return hexGridField(size.width, size.height, c1, c2, options.gap ?? 2, warnings);
    default:
      return null;
  }
}

/** Sample a field into a fresh `ImageData`-shaped buffer. Pure; no canvas. */
export function renderFieldToRgba(field: PatternField): Uint8ClampedArray {
  const { width, height } = field;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = field.sample(x + 0.5, y + 0.5);
      const offset = (y * width + x) * 4;
      out[offset] = r;
      out[offset + 1] = g;
      out[offset + 2] = b;
      out[offset + 3] = a;
    }
  }
  return out;
}

/**
 * Generate a procedural pattern tile.
 *
 * Returns the data URL plus the exact `width`/`height` the fill must use, the
 * `effectiveAngle` actually rendered, and any warnings. Deterministic for a
 * given `seed` (including `0`); without a seed the dot field is random by
 * design and says so in `warnings`.
 */
export function generatePatternTile(
  type: PatternType,
  options: PatternOptions,
  canvasFactory?: () => HTMLCanvasElement,
): PatternTile | null {
  const field = patternField(type, options);
  if (!field) return null;

  const canvas =
    canvasFactory?.() ??
    (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  canvas.width = field.width;
  canvas.height = field.height;
  const pixels = renderFieldToRgba(field);
  if (typeof ctx.createImageData === 'function') {
    try {
      // Build through the context so the buffer type is whatever this target
      // accepts; `new ImageData(...)` narrows the array's buffer type and can
      // reject a valid Uint8ClampedArray under strict lib typings.
      const imageData = ctx.createImageData(field.width, field.height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    } catch {
      // A target without real putImageData support (test doubles) still gets a
      // correctly sized canvas; the data URL contract is preserved.
    }
  }

  return {
    dataUrl: canvas.toDataURL(),
    width: field.width,
    height: field.height,
    effectiveAngle: field.effectiveAngle,
    warnings: field.warnings,
  };
}

/**
 * Back-compat shim: the data URL only. Prefer {@link generatePatternTile},
 * which also reports the tile geometry the fill must repeat with.
 */
export function generatePattern(
  type: PatternType,
  options: PatternOptions,
  canvasFactory?: () => HTMLCanvasElement,
): string {
  return generatePatternTile(type, options, canvasFactory)?.dataUrl ?? '';
}
