/**
 * Non-destructive geometry-modifier (warp) schema.
 *
 * Owned by the engine (the geometry core owns its wire types — see `Shape`/
 * `PathPoint`); `@varve/scene` re-exports these and stores them on nodes.
 *
 * Every modifier is a typed record with a stable `id`, an `enabled` flag and
 * ordered placement in a node's `warps` stack. Controls are stored in
 * normalized source-bounds coordinates (0..1 relative to the node's source
 * bounds at evaluation time) by default; `coordinateSpace: 'source-local'`
 * stores absolute source-local coordinates instead (fixed cage that does not
 * rebase when the source geometry changes).
 *
 * Validation policy (mirrors `@varve/scene` VariableModifier handling):
 *  - validate-on-ingest at the document boundary (codec/migration).
 *  - known kinds with structurally malformed payloads are dropped with a
 *    diagnostic; unknown future kinds are preserved inert so newer readers
 *    can recover them.
 *  - hard caps on stack size, mesh dimensions, and control points.
 *  - never free-form strings; never NaN/Infinity in stored controls.
 */

export type WarpQualityProfile = 'draft' | 'interactive' | 'high' | 'export';

/** Quality profiles map to absolute geometric tolerances (source-local px). */
export const WARP_QUALITY_TOLERANCE: Record<WarpQualityProfile, number> = {
  draft: 2,
  interactive: 0.5,
  high: 0.25,
  export: 0.1,
};

export interface WarpQualitySettings {
  profile: WarpQualityProfile;
  /**
   * Absolute geometric tolerance in source-local units for adaptive
   * subdivision. Defaults to the profile tolerance. A smaller tolerance
   * never yields less fidelity.
   */
  tolerance?: number;
  /** Per-segment recursion cap for adaptive subdivision (default 14). */
  maxSubdivision?: number;
  /** Hard cap on generated points per node evaluation (default 50000). */
  maxGeneratedPoints?: number;
}

export const DEFAULT_WARP_QUALITY: WarpQualitySettings = {
  profile: 'interactive',
  maxSubdivision: 14,
  maxGeneratedPoints: 50000,
};

export type WarpCoordinateSpace = 'normalized-source' | 'source-local';

export type WarpFoldoverPolicy = 'prevent' | 'warn' | 'allow';

export type WarpStrokeBehavior = 'preserve-width' | 'warp-appearance' | 'scale-approx';

export type WarpGradientBehavior = 'deform-with-object' | 'object-paint-space' | 'canvas-fixed';

export type WarpLayoutBounds = 'source' | 'visual';

export interface WarpSettings {
  /** Default evaluation quality (overridable per modifier). */
  quality?: WarpQualitySettings;
  /** How strokes are treated under warp. Default 'preserve-width'. */
  strokeBehavior?: WarpStrokeBehavior;
  /** How gradients are treated under warp. Default 'deform-with-object'. */
  gradientBehavior?: WarpGradientBehavior;
  /** Foldover policy. Default 'warn'. */
  foldoverPolicy?: WarpFoldoverPolicy;
  /** Which bounds drive layout. Default 'source' (layout never reflows). */
  layoutBounds?: WarpLayoutBounds;
}

export const DEFAULT_WARP_SETTINGS: WarpSettings = {
  strokeBehavior: 'preserve-width',
  gradientBehavior: 'deform-with-object',
  foldoverPolicy: 'warn',
  layoutBounds: 'source',
};

/** A point in 0..1 normalized source-bounds space. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface WarpModifierBase {
  /** Stable modifier id, unique within the owning node. */
  id: string;
  /** Display name (Inspector). */
  name?: string;
  /** Default true. Disabled modifiers are inert but keep their data. */
  enabled?: boolean;
  /**
   * Interpretation of control coordinates. Default 'normalized-source':
   * controls are 0..1 relative to the current source bounds and rebase
   * automatically when the source geometry resizes. 'source-local': controls
   * are absolute source-local coordinates (fixed cage).
   */
  coordinateSpace?: WarpCoordinateSpace;
  /** Per-modifier quality override. */
  quality?: WarpQualitySettings;
}

export interface SkewModifier extends WarpModifierBase {
  kind: 'skew';
  /** Horizontal shear in degrees. x' = x + tan(skewX)·y around `origin`. */
  skewX: number;
  /** Vertical shear in degrees. y' = y + tan(skewY)·x around `origin`. */
  skewY: number;
  /** Pivot as a normalized point in source bounds (default 0.5, 0.5). */
  origin: NormalizedPoint;
}

export interface PerspectiveCorners {
  tl: NormalizedPoint;
  tr: NormalizedPoint;
  br: NormalizedPoint;
  bl: NormalizedPoint;
}

export interface PerspectiveModifier extends WarpModifierBase {
  kind: 'perspective';
  /** Target corners of the projective cage, CCW from top-left. */
  corners: PerspectiveCorners;
}

/** Interior control points (two per edge) of a cubic envelope edge. */
export type EnvelopeEdgeControls = [NormalizedPoint, NormalizedPoint];

export interface EnvelopeModifier extends WarpModifierBase {
  kind: 'envelope';
  /** Cage corners, CCW from top-left (shared by adjacent edges). */
  corners: PerspectiveCorners;
  /** Interior cubic control points per edge. */
  edges: {
    top: EnvelopeEdgeControls;
    right: EnvelopeEdgeControls;
    bottom: EnvelopeEdgeControls;
    left: EnvelopeEdgeControls;
  };
  /** Interior interpolation. 'coons' is the only supported value. */
  interpolation: 'coons';
}

export interface WarpMeshPoint {
  x: number;
  y: number;
}

export interface MeshWarpModifier extends WarpModifierBase {
  kind: 'mesh-warp';
  /** Number of rows of cells (>= 1). */
  rows: number;
  /** Number of columns of cells (>= 1). */
  columns: number;
  /**
   * (rows+1)·(columns+1) control points, row-major, normalized (or
   * source-local per `coordinateSpace`).
   */
  points: WarpMeshPoint[];
  /** Bilinear is cell-local; bicubic uses smooth Catmull–Rom interpolation. */
  interpolation: 'bilinear' | 'bicubic';
}

export type BendMode = 'arc' | 'arch' | 'bulge' | 'shell' | 'flag' | 'wave' | 'rise';

export interface BendModifier extends WarpModifierBase {
  kind: 'bend';
  mode: BendMode;
  /** Signed strength in -1..1. */
  amount: number;
  /** Deformation axis. 'horizontal' bends along x (affects y). */
  axis: 'horizontal' | 'vertical';
  /** 0..1 position of the neutral line along the bend axis (default 0.5). */
  origin: number;
  /** Number of waves for 'wave'/'flag' (default 1, max 8). */
  wavelength?: number;
}

export type WarpModifier =
  | SkewModifier
  | PerspectiveModifier
  | EnvelopeModifier
  | MeshWarpModifier
  | BendModifier;

/** Maximum number of modifiers per node (serialization safety cap). */
export const MAX_WARPS_PER_NODE = 8;
/** Maximum mesh cells per axis. */
export const MAX_MESH_DIMENSION = 32;
/** Maximum control points a mesh can declare. */
export const MAX_MESH_POINTS = (MAX_MESH_DIMENSION + 1) * (MAX_MESH_DIMENSION + 1);
/** Maximum absolute control value (source-local units or normalized). */
export const MAX_WARP_CONTROL_ABSOLUTE = 1e6;

const KNOWN_KINDS = new Set(['skew', 'perspective', 'envelope', 'mesh-warp', 'bend']);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNormalizedPoint(
  v: unknown,
  absolute: boolean,
  lo = 0,
  hi = 1.0001,
): v is NormalizedPoint {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  const bound = absolute ? MAX_WARP_CONTROL_ABSOLUTE : hi;
  return (
    isFiniteNumber(p.x) &&
    isFiniteNumber(p.y) &&
    p.x >= (absolute ? -bound : lo) &&
    p.x <= bound &&
    p.y >= (absolute ? -bound : lo) &&
    p.y <= bound
  );
}

function isNormalizedPointPair(
  v: unknown,
  absolute: boolean,
  lo = 0,
  hi = 1.0001,
): v is [NormalizedPoint, NormalizedPoint] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    isNormalizedPoint(v[0], absolute, lo, hi) &&
    isNormalizedPoint(v[1], absolute, lo, hi)
  );
}

// Envelope interior controls may legitimately leave the unit square (curved
// edges bulge outside the cage). Bounded to keep corrupt data from exploding.
const ENVELOPE_CONTROL_LO = -2;
const ENVELOPE_CONTROL_HI = 3;
// Envelope corners share the same bounded editing domain as the edge
// controls: the Coons patch is defined for corners anywhere in the extended
// plane, and the Warp tool's primary gesture is dragging a corner OUTWARD
// past the source box. Pinning corners to [0,1] silently discarded every
// such drag (validateWarpModifier → null → updateWarp no-op).
const ENVELOPE_CORNER_LO = ENVELOPE_CONTROL_LO;
const ENVELOPE_CORNER_HI = ENVELOPE_CONTROL_HI;
// A mesh must be able to extend past its source box (for perspective and
// outward bulges). Keep the same bounded editing domain as envelope handles.
const MESH_CONTROL_LO = -2;
const MESH_CONTROL_HI = 3;

function isCorners(
  v: unknown,
  absolute: boolean,
  lo = 0,
  hi = 1.0001,
): v is PerspectiveCorners {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    isNormalizedPoint(c.tl, absolute, lo, hi) &&
    isNormalizedPoint(c.tr, absolute, lo, hi) &&
    isNormalizedPoint(c.br, absolute, lo, hi) &&
    isNormalizedPoint(c.bl, absolute, lo, hi)
  );
}

function isWarpQuality(v: unknown): v is WarpQualitySettings {
  if (typeof v !== 'object' || v === null) return false;
  const q = v as Record<string, unknown>;
  if (
    q.profile !== undefined &&
    (typeof q.profile !== 'string' || !(q.profile in WARP_QUALITY_TOLERANCE))
  )
    return false;
  if (q.tolerance !== undefined && !isFiniteNumber(q.tolerance)) return false;
  if (q.tolerance !== undefined && (q.tolerance as number) <= 0) return false;
  if (q.maxSubdivision !== undefined && !isFiniteNumber(q.maxSubdivision)) return false;
  if (q.maxGeneratedPoints !== undefined && !isFiniteNumber(q.maxGeneratedPoints)) return false;
  return true;
}

function sanitizeQuality(raw: Record<string, unknown>): WarpQualitySettings | undefined {
  if (!isWarpQuality(raw)) return undefined;
  return {
    ...DEFAULT_WARP_QUALITY,
    ...(raw.profile !== undefined ? { profile: raw.profile as WarpQualityProfile } : {}),
    ...(raw.tolerance !== undefined ? { tolerance: raw.tolerance as number } : {}),
    ...(raw.maxSubdivision !== undefined ? { maxSubdivision: raw.maxSubdivision as number } : {}),
    ...(raw.maxGeneratedPoints !== undefined
      ? { maxGeneratedPoints: raw.maxGeneratedPoints as number }
      : {}),
  };
}

/**
 * Structural validation of one serialized modifier. Returns the sanitized
 * modifier or null when the entry is unrecoverably malformed.
 *
 * Unknown kinds are preserved inert (a future reader may understand them);
 * malformed known kinds are dropped.
 */
export function validateWarpModifier(raw: unknown): WarpModifier | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const id = typeof m.id === 'string' && m.id.length > 0 ? m.id : null;
  if (!id) return null;
  const absolute = m.coordinateSpace === 'source-local';
  const base: WarpModifierBase = {
    id,
    ...(typeof m.name === 'string' ? { name: m.name } : {}),
    ...(m.enabled === true || m.enabled === undefined ? {} : { enabled: m.enabled === true }),
    ...(m.coordinateSpace === 'source-local' ? { coordinateSpace: 'source-local' as const } : {}),
    ...(m.quality !== undefined
      ? { quality: sanitizeQuality(m.quality as Record<string, unknown>) }
      : {}),
  };

  const kind = m.kind;
  if (!KNOWN_KINDS.has(kind as string)) {
    // Unknown future kind: preserve inert. The document stays loadable and a
    // diagnostic is surfaced at the codec boundary via the warnings array.
    return { ...base, kind: kind as string } as unknown as WarpModifier;
  }

  switch (kind) {
    case 'skew': {
      if (!isFiniteNumber(m.skewX) || !isFiniteNumber(m.skewY)) return null;
      const origin = isNormalizedPoint(m.origin, false)
        ? (m.origin as NormalizedPoint)
        : { x: 0.5, y: 0.5 };
      return { ...base, kind: 'skew', skewX: m.skewX, skewY: m.skewY, origin };
    }
    case 'perspective': {
      if (!isCorners(m.corners, absolute)) return null;
      return { ...base, kind: 'perspective', corners: m.corners as PerspectiveCorners };
    }
    case 'envelope': {
      if (!isCorners(m.corners, absolute, ENVELOPE_CORNER_LO, ENVELOPE_CORNER_HI)) return null;
      const edges = m.edges as Record<string, unknown> | undefined;
      if (
        !edges ||
        !isNormalizedPointPair(edges.top, absolute, ENVELOPE_CONTROL_LO, ENVELOPE_CONTROL_HI) ||
        !isNormalizedPointPair(edges.right, absolute, ENVELOPE_CONTROL_LO, ENVELOPE_CONTROL_HI) ||
        !isNormalizedPointPair(edges.bottom, absolute, ENVELOPE_CONTROL_LO, ENVELOPE_CONTROL_HI) ||
        !isNormalizedPointPair(edges.left, absolute, ENVELOPE_CONTROL_LO, ENVELOPE_CONTROL_HI)
      ) {
        return null;
      }
      return {
        ...base,
        kind: 'envelope',
        corners: m.corners as PerspectiveCorners,
        edges: {
          top: edges.top as EnvelopeEdgeControls,
          right: edges.right as EnvelopeEdgeControls,
          bottom: edges.bottom as EnvelopeEdgeControls,
          left: edges.left as EnvelopeEdgeControls,
        },
        interpolation: 'coons',
      };
    }
    case 'mesh-warp': {
      if (!isFiniteNumber(m.rows) || !isFiniteNumber(m.columns)) return null;
      let rows = Math.trunc(m.rows);
      let columns = Math.trunc(m.columns);
      if (rows < 1 || columns < 1) return null;
      rows = Math.min(rows, MAX_MESH_DIMENSION);
      columns = Math.min(columns, MAX_MESH_DIMENSION);
      const expected = (rows + 1) * (columns + 1);
      if (!Array.isArray(m.points) || m.points.length !== expected) return null;
      const points: WarpMeshPoint[] = [];
      for (const p of m.points) {
        if (!isNormalizedPoint(p, absolute, MESH_CONTROL_LO, MESH_CONTROL_HI)) return null;
        points.push({ x: p.x, y: p.y });
      }
      const interpolation = m.interpolation === 'bicubic' ? 'bicubic' : 'bilinear';
      return { ...base, kind: 'mesh-warp', rows, columns, points, interpolation };
    }
    case 'bend': {
      const modes: BendMode[] = ['arc', 'arch', 'bulge', 'shell', 'flag', 'wave', 'rise'];
      if (!modes.includes(m.mode as BendMode)) return null;
      if (!isFiniteNumber(m.amount)) return null;
      const amount = Math.max(-1, Math.min(1, m.amount));
      const axis = m.axis === 'vertical' ? 'vertical' : 'horizontal';
      const origin = isFiniteNumber(m.origin) ? Math.max(0, Math.min(1, m.origin)) : 0.5;
      const wavelength = isFiniteNumber(m.wavelength)
        ? Math.max(1, Math.min(8, Math.trunc(m.wavelength)))
        : undefined;
      return {
        ...base,
        kind: 'bend',
        mode: m.mode as BendMode,
        amount,
        axis,
        origin,
        ...(wavelength !== undefined ? { wavelength } : {}),
      };
    }
    default:
      return null;
  }
}

export interface WarpValidationResult {
  /** Sanitized, valid modifiers in original order. */
  modifiers: WarpModifier[];
  /** Diagnostics for entries that were dropped or preserved inert. */
  warnings: string[];
  /** Number of entries dropped as unrecoverable. */
  dropped: number;
}

/**
 * Sanitize an untrusted serialized modifier stack. Known malformed entries
 * are dropped; unknown future kinds are preserved inert; the stack is capped
 * at MAX_WARPS_PER_NODE.
 */
export function validateWarpModifiers(raw: unknown): WarpValidationResult {
  if (!Array.isArray(raw)) {
    return {
      modifiers: [],
      warnings: ['warp stack is not an array; dropped'],
      dropped: raw !== undefined ? 1 : 0,
    };
  }
  const modifiers: WarpModifier[] = [];
  const warnings: string[] = [];
  let dropped = 0;
  for (const entry of raw.slice(0, MAX_WARPS_PER_NODE)) {
    const sanitized = validateWarpModifier(entry);
    if (sanitized) {
      modifiers.push(sanitized);
    } else {
      dropped++;
      warnings.push(
        `dropped malformed warp modifier ${typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).id === 'string' ? `"${(entry as Record<string, unknown>).id}"` : '(unnamed)'}`,
      );
    }
  }
  if (raw.length > MAX_WARPS_PER_NODE) {
    dropped += raw.length - MAX_WARPS_PER_NODE;
    warnings.push(`warp stack exceeded ${MAX_WARPS_PER_NODE} entries; extras dropped`);
  }
  return { modifiers, warnings, dropped };
}

export interface WarpSettingsValidationResult {
  settings: WarpSettings | undefined;
  warnings: string[];
}

/** Sanitize node-level warp evaluation settings. */
export function validateWarpSettings(raw: unknown): WarpSettingsValidationResult {
  if (typeof raw !== 'object' || raw === null) return { settings: undefined, warnings: [] };
  const s = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const settings: WarpSettings = {};
  if (s.quality !== undefined) {
    const q = sanitizeQuality(s.quality as Record<string, unknown>);
    if (q) settings.quality = q;
    else warnings.push('warpSettings.quality malformed; dropped');
  }
  const strokes: WarpStrokeBehavior[] = ['preserve-width', 'warp-appearance', 'scale-approx'];
  if (s.strokeBehavior !== undefined && strokes.includes(s.strokeBehavior as WarpStrokeBehavior)) {
    settings.strokeBehavior = s.strokeBehavior as WarpStrokeBehavior;
  }
  const gradients: WarpGradientBehavior[] = [
    'deform-with-object',
    'object-paint-space',
    'canvas-fixed',
  ];
  if (
    s.gradientBehavior !== undefined &&
    gradients.includes(s.gradientBehavior as WarpGradientBehavior)
  ) {
    settings.gradientBehavior = s.gradientBehavior as WarpGradientBehavior;
  }
  const foldovers: WarpFoldoverPolicy[] = ['prevent', 'warn', 'allow'];
  if (
    s.foldoverPolicy !== undefined &&
    foldovers.includes(s.foldoverPolicy as WarpFoldoverPolicy)
  ) {
    settings.foldoverPolicy = s.foldoverPolicy as WarpFoldoverPolicy;
  }
  const layouts: WarpLayoutBounds[] = ['source', 'visual'];
  if (s.layoutBounds !== undefined && layouts.includes(s.layoutBounds as WarpLayoutBounds)) {
    settings.layoutBounds = s.layoutBounds as WarpLayoutBounds;
  }
  return { settings, warnings };
}

/** Effective quality settings for a modifier, merging node defaults. */
export function effectiveWarpQuality(
  nodeSettings: WarpQualitySettings | undefined,
  modifierQuality: WarpQualitySettings | undefined,
): WarpQualitySettings {
  const base: WarpQualitySettings = {
    ...DEFAULT_WARP_QUALITY,
    ...(nodeSettings ? nodeSettings : {}),
  };
  return modifierQuality ? { ...base, ...modifierQuality } : base;
}

/** Does this stack contain at least one enabled modifier? */
export function hasLiveWarps(warps: WarpModifier[] | undefined): boolean {
  return (warps ?? []).some((w) => w.enabled !== false);
}

/** Effective stroke behavior for the stack. */
export function effectiveStrokeBehavior(settings: WarpSettings | undefined): WarpStrokeBehavior {
  return settings?.strokeBehavior ?? DEFAULT_WARP_SETTINGS.strokeBehavior!;
}
