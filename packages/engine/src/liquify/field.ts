/**
 * Liquify deformation field — persistent, source-preserving brush-driven warp.
 *
 * Model
 * -----
 * A `rows × columns` grid of control points covers the layer's reference
 * rectangle. Each control point carries a displacement in *reference pixel
 * units*. The field is interpreted as an output→source offset map:
 *
 *   output(x) = sample(source, x + D(x))
 *
 * where `D` is bilinearly interpolated from the grid. Storing the inverse
 * field (rather than a forward flow) means rendering is a single gather pass
 * with no hole-filling, which is what keeps repeated previews from tearing.
 *
 * Invariants
 * ----------
 * - The identity field (`displacement` all zeros) is a bit-exact no-op.
 * - Displacements are finite and bounded (`MAX_LIQUIFY_DISPLACEMENT`), which
 *   is the documented foldover policy: folds may form, but a control point can
 *   never ask for a sample farther than half the reference extent away.
 * - The field never stores pixels; the source tiles remain authoritative.
 *
 * Unit conventions
 * ----------------
 * - Grid point (c, r) sits at `(c/columns, r/rows)` in normalized reference
 *   space; interpolation is bilinear in that space.
 * - Displacements are pixels at `referenceWidth × referenceHeight`. A layer
 *   resized later scales the displacement with the layer, so authored
 *   deformations keep their relative shape.
 */

export const LIQUIFY_FIELD_VERSION = 1;
export const LIQUIFY_MIN_GRID = 1;
export const LIQUIFY_MAX_GRID = 64;
export const LIQUIFY_DEFAULT_GRID = 32;

/** Maximum authored displacement as a fraction of the reference extent. */
export const MAX_LIQUIFY_DISPLACEMENT_FRACTION = 0.5;

export type LiquifyMode =
  | 'push'
  | 'bloat'
  | 'pucker'
  | 'twirl-cw'
  | 'twirl-ccw'
  | 'restore'
  | 'smooth';

export interface LiquifyField {
  version: typeof LIQUIFY_FIELD_VERSION;
  /** Reference extent the displacements were authored against. */
  referenceWidth: number;
  referenceHeight: number;
  rows: number;
  columns: number;
  /** Row-major [dx, dy] pairs in reference pixel units. Length = 2·(rows+1)·(columns+1). */
  displacement: number[];
}

export interface Rgba8 {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Freeze (protection) coverage. Stored at a bounded resolution because it only
 * shapes brush influence during authoring — it is never part of rendering.
 * Values are 0 (fully editable) to 255 (fully frozen).
 */
export interface LiquifyFreezeMask {
  width: number;
  height: number;
  /** RLE-encoded coverage, base64. See `encodeFreezeMask`/`decodeFreezeMask`. */
  rle: string;
}

export const LIQUIFY_FREEZE_MAX_DIMENSION = 512;
export const LIQUIFY_FREEZE_MAX_PIXELS = LIQUIFY_FREEZE_MAX_DIMENSION ** 2;

const MAX_LIQUIFY_REFERENCE_EXTENT = 1_000_000_000;
const MAX_DAB_DT_MS = 250;

export function clampGridDimension(value: unknown, fallback = LIQUIFY_DEFAULT_GRID): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(LIQUIFY_MIN_GRID, Math.min(LIQUIFY_MAX_GRID, Math.trunc(value)));
}

/** Create an identity field for a reference extent. */
export function createLiquifyField(
  referenceWidth: number,
  referenceHeight: number,
  rows: number = LIQUIFY_DEFAULT_GRID,
  columns: number = rows,
): LiquifyField {
  const safeRows = clampGridDimension(rows);
  const safeColumns = clampGridDimension(columns);
  const count = (safeRows + 1) * (safeColumns + 1);
  return {
    version: LIQUIFY_FIELD_VERSION,
    referenceWidth: normalizeReferenceExtent(referenceWidth),
    referenceHeight: normalizeReferenceExtent(referenceHeight),
    rows: safeRows,
    columns: safeColumns,
    displacement: new Array<number>(count * 2).fill(0),
  };
}

export function cloneLiquifyField(field: LiquifyField): LiquifyField {
  return { ...field, displacement: [...field.displacement] };
}

function clampFieldValue(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-max, Math.min(max, value));
}

/** Clamp all displacements to the bounded foldover policy. Returns a new field. */
export function clampLiquifyField(field: LiquifyField): LiquifyField {
  const maxX = field.referenceWidth * MAX_LIQUIFY_DISPLACEMENT_FRACTION;
  const maxY = field.referenceHeight * MAX_LIQUIFY_DISPLACEMENT_FRACTION;
  const out = cloneLiquifyField(field);
  for (let i = 0; i < out.displacement.length; i += 2) {
    out.displacement[i] = clampFieldValue(out.displacement[i]!, maxX);
    out.displacement[i + 1] = clampFieldValue(out.displacement[i + 1]!, maxY);
  }
  return out;
}

/** True when every control point is effectively at rest. */
export function isIdentityLiquifyField(field: LiquifyField, epsilon = 1e-4): boolean {
  for (const value of field.displacement) {
    if (Math.abs(value) > epsilon) return false;
  }
  return true;
}

/**
 * Sample the displacement (reference pixels) at a normalized reference point.
 * Bilinear within the grid cell; clamped at the outer boundary.
 */
export function sampleLiquifyDisplacement(
  field: LiquifyField,
  u: number,
  v: number,
  target: [number, number],
): [number, number] {
  const { rows, columns, displacement } = field;
  if (
    rows < 1 ||
    columns < 1 ||
    !Number.isFinite(u) ||
    !Number.isFinite(v) ||
    displacement.length < (rows + 1) * (columns + 1) * 2
  ) {
    target[0] = 0;
    target[1] = 0;
    return target;
  }
  const gx = Math.max(0, Math.min(1, u)) * columns;
  const gy = Math.max(0, Math.min(1, v)) * rows;
  const c0 = Math.min(columns - 1, Math.floor(gx));
  const r0 = Math.min(rows - 1, Math.floor(gy));
  const c1 = Math.min(columns, c0 + 1);
  const r1 = Math.min(rows, r0 + 1);
  const fx = gx - c0;
  const fy = gy - r0;

  const stride = columns + 1;
  const i00 = (r0 * stride + c0) * 2;
  const i10 = (r0 * stride + c1) * 2;
  const i01 = (r1 * stride + c0) * 2;
  const i11 = (r1 * stride + c1) * 2;

  const dx =
    (1 - fy) * ((1 - fx) * displacement[i00]! + fx * displacement[i10]!) +
    fy * ((1 - fx) * displacement[i01]! + fx * displacement[i11]!);
  const dy =
    (1 - fy) * ((1 - fx) * displacement[i00 + 1]! + fx * displacement[i10 + 1]!) +
    fy * ((1 - fx) * displacement[i01 + 1]! + fx * displacement[i11 + 1]!);
  target[0] = dx;
  target[1] = dy;
  return target;
}

/** Maximum absolute displacement of a single control point, per axis. */
export function maxLiquifyDisplacement(field: LiquifyField): [number, number] {
  return [
    field.referenceWidth * MAX_LIQUIFY_DISPLACEMENT_FRACTION,
    field.referenceHeight * MAX_LIQUIFY_DISPLACEMENT_FRACTION,
  ];
}

// ── Brush application ────────────────────────────────────────────────────────

export interface LiquifyDab {
  /** Brush center in reference pixel coordinates. */
  x: number;
  y: number;
  /** Brush radius in reference pixels. */
  radius: number;
  /** 0..1 overall strength. */
  strength: number;
  /** 0..1 pointer pressure (already includes the mouse default). */
  pressure: number;
  /** Push delta since the previous dab, reference pixels. */
  deltaX: number;
  deltaY: number;
  /**
   * Elapsed time since the previous dab in milliseconds. Only the time-based
   * modes (bloat/pucker/twirl) use it; a stationary push must not drift.
   */
  dtMs?: number;
  /** Rotation for twirl, radians of pointer travel mapped by the tool. */
  rotation?: number;
}

function smoothFalloff(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const x = 1 - t;
  return x * x * (3 - 2 * x);
}

/**
 * Apply one brush dab to the field. Returns a new field; the input is never
 * mutated so history can keep the previous value by reference.
 *
 * - `push` uses the incremental delta only (no drift when stationary).
 * - `bloat`/`pucker`/`twirl` accumulate over time and pointer travel; `dtMs`
 *   scales the per-dab amount so event rate does not change the result.
 * - `restore` moves control points toward the identity field.
 * - `smooth` runs a local Laplacian relaxation on the displacement grid.
 */
export function applyLiquifyDab(
  field: LiquifyField,
  mode: LiquifyMode,
  dab: LiquifyDab,
  freeze: FreezeSampler | null = null,
): LiquifyField {
  if (
    !Number.isFinite(dab.x) ||
    !Number.isFinite(dab.y) ||
    !Number.isFinite(dab.radius) ||
    !Number.isFinite(dab.strength) ||
    !Number.isFinite(dab.deltaX) ||
    !Number.isFinite(dab.deltaY) ||
    !(dab.radius > 0) ||
    dab.strength <= 0 ||
    field.displacement.length === 0
  ) {
    return field;
  }
  const pressure = Number.isFinite(dab.pressure) ? Math.max(0, Math.min(1, dab.pressure)) : 0.5;
  const strength = Math.max(0, Math.min(1, dab.strength)) * pressure;
  if (strength <= 0) return field;

  const refW = field.referenceWidth;
  const refH = field.referenceHeight;
  const [maxDx, maxDy] = maxLiquifyDisplacement(field);
  const columns = field.columns;
  const rows = field.rows;
  const stride = columns + 1;
  const r2 = dab.radius * dab.radius;

  // Time normalization: a 60 Hz stream maps to one "unit" per 16.7 ms, so a
  // fast device emitting 240 Hz dabs deforms at the same rate as a mouse.
  const dtUnits =
    dab.dtMs === undefined
      ? 1
      : Number.isFinite(dab.dtMs)
        ? Math.min(MAX_DAB_DT_MS, Math.max(0, dab.dtMs)) / (1000 / 60)
        : 0;

  const next = cloneLiquifyField(field);
  const d = next.displacement;

  for (let r = 0; r <= rows; r++) {
    const py = (r / rows) * refH;
    for (let c = 0; c <= columns; c++) {
      const px = (c / columns) * refW;
      const dxp = px - dab.x;
      const dyp = py - dab.y;
      const dist2 = dxp * dxp + dyp * dyp;
      if (dist2 > r2) continue;
      const dist = Math.sqrt(dist2);
      let weight = smoothFalloff(dist / dab.radius) * strength;
      if (freeze) {
        // Protection is sampled at the control point that will move; the
        // falloff still fades with distance, so a frozen boundary cannot be
        // jumped by a large soft brush.
        const frozen = freeze.sampleNormalized(px / refW, py / refH);
        weight *= 1 - Math.max(0, Math.min(1, frozen));
      }
      if (weight <= 0) continue;

      const index = (r * stride + c) * 2;
      let dx = d[index]!;
      let dy = d[index + 1]!;

      switch (mode) {
        case 'push': {
          // D is output→source, so moving content *with* the pointer means
          // subtracting the pointer delta from the source offset.
          dx -= dab.deltaX * weight;
          dy -= dab.deltaY * weight;
          break;
        }
        case 'bloat': {
          const amount = weight * dtUnits * dab.radius * 0.05;
          if (dist > 1e-6) {
            // Content expands away from the centre, so its source sits closer
            // to the centre than the output point.
            dx -= (dxp / dist) * amount;
            dy -= (dyp / dist) * amount;
          }
          break;
        }
        case 'pucker': {
          const amount = weight * dtUnits * dab.radius * 0.05;
          if (dist > 1e-6) {
            dx += (dxp / dist) * amount;
            dy += (dyp / dist) * amount;
          }
          break;
        }
        case 'twirl-cw':
        case 'twirl-ccw': {
          // Clockwise content rotation samples from a counter-clockwise
          // rotated source offset.
          const direction = mode === 'twirl-cw' ? -1 : 1;
          const angle = direction * weight * dtUnits * 0.12;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          // Rotate the point's current offset around the brush center. This is
          // applied to the shifted position so repeated dabs swirl rather than
          // rescaling the same vector.
          const ox = px + dx - dab.x;
          const oy = py + dy - dab.y;
          const rx = ox * cos - oy * sin;
          const ry = ox * sin + oy * cos;
          dx = dab.x + rx - px;
          dy = dab.y + ry - py;
          break;
        }
        case 'restore': {
          const keep = 1 - Math.max(0, Math.min(1, weight)) * 0.35 * dtUnits;
          dx *= Math.max(0, keep);
          dy *= Math.max(0, keep);
          break;
        }
        case 'smooth': {
          const sx =
            (d[(r * stride + Math.max(0, c - 1)) * 2] ?? dx) * 0.25 +
            (d[(r * stride + Math.min(columns, c + 1)) * 2] ?? dx) * 0.25 +
            (d[(Math.max(0, r - 1) * stride + c) * 2] ?? dx) * 0.25 +
            (d[(Math.min(rows, r + 1) * stride + c) * 2] ?? dx) * 0.25;
          const sy =
            (d[(r * stride + Math.max(0, c - 1)) * 2 + 1] ?? dy) * 0.25 +
            (d[(r * stride + Math.min(columns, c + 1)) * 2 + 1] ?? dy) * 0.25 +
            (d[(Math.max(0, r - 1) * stride + c) * 2 + 1] ?? dy) * 0.25 +
            (d[(Math.min(rows, r + 1) * stride + c) * 2 + 1] ?? dy) * 0.25;
          const mix = Math.max(0, Math.min(1, weight * dtUnits));
          dx += (sx - dx) * mix;
          dy += (sy - dy) * mix;
          break;
        }
      }

      d[index] = clampFieldValue(dx, maxDx);
      d[index + 1] = clampFieldValue(dy, maxDy);
    }
  }
  return next;
}

/** Reset a region of the field back toward identity. */
export function resetLiquifyRegion(
  field: LiquifyField,
  x: number,
  y: number,
  radius: number,
  amount = 1,
): LiquifyField {
  return applyLiquifyDab(
    field,
    'restore',
    {
      x,
      y,
      radius,
      strength: Math.max(0, Math.min(1, amount)),
      pressure: 1,
      deltaX: 0,
      deltaY: 0,
      dtMs: 1000 / 60,
    },
    null,
  );
}

// ── Freeze mask ──────────────────────────────────────────────────────────────

export interface FreezeSampler {
  /** width/height coverage 0..255; returns 0..1 coverage. */
  sampleNormalized(u: number, v: number): number;
}

/** RLE-encode coverage bytes as base64 (`value:count;` groups). */
export function encodeFreezeMask(data: Uint8Array): string {
  const parts: string[] = [];
  let run = 1;
  for (let i = 1; i <= data.length; i++) {
    if (i < data.length && data[i] === data[i - 1]) {
      run++;
      continue;
    }
    parts.push(`${data[i - 1]!.toString(36)}:${run.toString(36)}`);
    run = 1;
  }
  return base64Encode(parts.join(','));
}

export function decodeFreezeMask(rle: string, expectedLength?: number): Uint8Array | null {
  const text = base64Decode(rle);
  if (text === null) return null;
  if (text.length === 0) return new Uint8Array(0);
  if (
    expectedLength !== undefined &&
    (!Number.isSafeInteger(expectedLength) ||
      expectedLength < 0 ||
      expectedLength > LIQUIFY_FREEZE_MAX_PIXELS)
  ) {
    return null;
  }
  const out: number[] = [];
  for (const part of text.split(',')) {
    const colon = part.indexOf(':');
    if (colon <= 0) return null;
    const value = Number.parseInt(part.slice(0, colon), 36);
    const count = Number.parseInt(part.slice(colon + 1), 36);
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(count) || value < 0 || value > 255) {
      return null;
    }
    const limit = expectedLength ?? LIQUIFY_FREEZE_MAX_PIXELS;
    if (count <= 0 || count > limit - out.length) return null;
    for (let i = 0; i < count; i++) out.push(value);
  }
  if (expectedLength !== undefined && out.length !== expectedLength) return null;
  return Uint8Array.from(out);
}

/** Build a bilinear freeze sampler from raw coverage. */
export function createFreezeSampler(
  width: number,
  height: number,
  data: Uint8Array,
): FreezeSampler | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > LIQUIFY_FREEZE_MAX_DIMENSION ||
    height > LIQUIFY_FREEZE_MAX_DIMENSION ||
    data.length !== width * height
  ) {
    return null;
  }
  return {
    sampleNormalized(u: number, v: number): number {
      if (!Number.isFinite(u) || !Number.isFinite(v)) return 0;
      // Pixel-center convention: normalized 0..1 spans the full extent, so
      // pixel (i) center is at (i + 0.5) / width.
      const x = Math.max(0, Math.min(1, u)) * width - 0.5;
      const y = Math.max(0, Math.min(1, v)) * height - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
      const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, x - x0));
      const fy = Math.max(0, Math.min(1, y - y0));
      const a = data[y0 * width + x0]! / 255;
      const b = data[y0 * width + x1]! / 255;
      const c = data[y1 * width + x0]! / 255;
      const d = data[y1 * width + x1]! / 255;
      return (1 - fy) * ((1 - fx) * a + fx * b) + fy * ((1 - fx) * c + fx * d);
    },
  };
}

/** Stamp a soft circular region of the freeze mask. */
export function stampFreezeMask(
  data: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  freeze: boolean,
  hardness = 0.6,
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > LIQUIFY_FREEZE_MAX_DIMENSION ||
    height > LIQUIFY_FREEZE_MAX_DIMENSION ||
    data.length !== width * height ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(radius) ||
    radius <= 0
  ) {
    return;
  }
  const r = Math.max(1, radius);
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(width - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(height - 1, Math.ceil(cy + r));
  const hard = Math.max(0.01, Math.min(0.99, hardness));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dist > r) continue;
      const t = dist / r;
      const falloff = t <= hard ? 1 : 1 - (t - hard) / (1 - hard);
      const amount = Math.max(0, Math.min(1, falloff));
      const index = y * width + x;
      const current = data[index]! / 255;
      const target = freeze ? 1 : 0;
      data[index] = Math.round((current + (target - current) * amount) * 255);
    }
  }
}

/**
 * Structural validation for an untrusted serialized field. Returns a sanitized
 * field or null when the payload cannot be recovered. Malformed numeric entries
 * are repaired to zero rather than dropping the whole deformation.
 */
export function validateLiquifyField(raw: unknown): LiquifyField | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== undefined && value.version !== LIQUIFY_FIELD_VERSION) return null;
  const width = value.referenceWidth;
  const height = value.referenceHeight;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null;
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
  const rows = clampGridDimension(value.rows);
  const columns = clampGridDimension(value.columns);
  const expected = (rows + 1) * (columns + 1) * 2;
  if (!Array.isArray(value.displacement) || value.displacement.length !== expected) return null;
  const referenceWidth = normalizeReferenceExtent(width);
  const referenceHeight = normalizeReferenceExtent(height);
  const maxX = referenceWidth * MAX_LIQUIFY_DISPLACEMENT_FRACTION;
  const maxY = referenceHeight * MAX_LIQUIFY_DISPLACEMENT_FRACTION;
  const displacement = new Array<number>(expected);
  for (let i = 0; i < expected; i += 2) {
    const dx = value.displacement[i];
    const dy = value.displacement[i + 1];
    displacement[i] = clampFieldValue(typeof dx === 'number' ? dx : 0, maxX);
    displacement[i + 1] = clampFieldValue(typeof dy === 'number' ? dy : 0, maxY);
  }
  return {
    version: LIQUIFY_FIELD_VERSION,
    referenceWidth,
    referenceHeight,
    rows,
    columns,
    displacement,
  };
}

function normalizeReferenceExtent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.min(MAX_LIQUIFY_REFERENCE_EXTENT, Math.round(value)));
}

/** Cheap deterministic revision for render caches (FNV-1a over quantized values). */
export function liquifyFieldRevision(field: LiquifyField | undefined | null): string {
  if (!field) return 'none';
  let h = 2166136261;
  const mix = (value: number) => {
    h ^= value & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (value >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (value >>> 16) & 0xff;
    h = Math.imul(h, 16777619);
  };
  mix(field.referenceWidth);
  mix(field.referenceHeight);
  mix(field.rows);
  mix(field.columns);
  for (const value of field.displacement) {
    // Quantize to 1/64 px: far finer than any visible sampling difference,
    // far cheaper than hashing the raw float bits.
    mix(Math.round((Number.isFinite(value) ? value : 0) * 64) | 0);
  }
  return h.toString(36);
}

// ── base64 helpers (Node + browser, no Buffer dependency) ────────────────────

function base64Encode(text: string): string {
  if (typeof btoa === 'function') return btoa(text);
  const nodeBuffer = (
    globalThis as {
      Buffer?: { from(value: string, encoding: string): { toString(e: string): string } };
    }
  ).Buffer;
  if (nodeBuffer) return nodeBuffer.from(text, 'binary').toString('base64');
  throw new Error('No base64 encoder available');
}

function base64Decode(text: string): string | null {
  try {
    if (typeof atob === 'function') return atob(text);
    const nodeBuffer = (
      globalThis as {
        Buffer?: { from(value: string, encoding: string): { toString(e: string): string } };
      }
    ).Buffer;
    if (nodeBuffer) return nodeBuffer.from(text, 'base64').toString('binary');
    return null;
  } catch {
    return null;
  }
}
