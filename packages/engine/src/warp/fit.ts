/**
 * Deterministic warp proposals and presets.
 *
 * Everything here derives modifier parameters from geometry alone (no AI):
 *  - presets: parameterized ordinary modifiers (skew/perspective/envelope/
 *    mesh/bend) that the user then edits like any other modifier.
 *  - fitting: deterministic derivation of a perspective cage from a target
 *    quadrilateral, and of a cubic envelope edge from an existing path.
 *
 * Fit helpers never claim exact silhouette matching — they produce bounded
 * approximations with documented fit-quality estimates.
 */

import type { PathPoint } from '../types';
import type { WarpRect } from './geometry';
import type {
  BendMode,
  EnvelopeModifier,
  NormalizedPoint,
  PerspectiveCorners,
  PerspectiveModifier,
  WarpModifier,
} from './types';

export type WarpPresetKind =
  | 'skew-horizontal'
  | 'skew-vertical'
  | 'perspective-left'
  | 'perspective-right'
  | 'arc-up'
  | 'arc-down'
  | 'arch'
  | 'shell'
  | 'bulge'
  | 'pinch'
  | 'flag'
  | 'wave'
  | 'rise'
  | 'four-corner'
  | 'four-edge'
  | 'mesh-4x4';

export interface PresetDescription {
  kind: WarpPresetKind;
  label: string;
  category: 'basic' | 'arc' | 'wave' | 'bulge' | 'custom';
}

export const WARP_PRESET_DESCRIPTIONS: PresetDescription[] = [
  { kind: 'skew-horizontal', label: 'Horizontal skew', category: 'basic' },
  { kind: 'skew-vertical', label: 'Vertical skew', category: 'basic' },
  { kind: 'perspective-left', label: 'Perspective left', category: 'basic' },
  { kind: 'perspective-right', label: 'Perspective right', category: 'basic' },
  { kind: 'arc-up', label: 'Arc up', category: 'arc' },
  { kind: 'arc-down', label: 'Arc down', category: 'arc' },
  { kind: 'arch', label: 'Arch', category: 'arc' },
  { kind: 'shell', label: 'Shell', category: 'arc' },
  { kind: 'flag', label: 'Flag', category: 'wave' },
  { kind: 'wave', label: 'Wave', category: 'wave' },
  { kind: 'bulge', label: 'Bulge', category: 'bulge' },
  { kind: 'pinch', label: 'Pinch', category: 'bulge' },
  { kind: 'rise', label: 'Rise', category: 'bulge' },
  { kind: 'four-corner', label: 'Four-corner perspective', category: 'custom' },
  { kind: 'four-edge', label: 'Four-edge envelope', category: 'custom' },
  { kind: 'mesh-4x4', label: '4×4 mesh', category: 'custom' },
];

let presetCounter = 0;

export function nextWarpModifierId(prefix = 'warp'): string {
  presetCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${presetCounter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const C = (x: number, y: number): NormalizedPoint => ({ x, y });
const CORNERS = (
  tl: NormalizedPoint,
  tr: NormalizedPoint,
  br: NormalizedPoint,
  bl: NormalizedPoint,
): PerspectiveCorners => ({ tl, tr, br, bl });

/** Build an ordinary modifier from a preset (all parameters user-editable). */
export function makeWarpPreset(kind: WarpPresetKind): WarpModifier {
  const id = nextWarpModifierId();
  switch (kind) {
    case 'skew-horizontal':
      return { id, kind: 'skew', skewX: 20, skewY: 0, origin: C(0.5, 0.5) };
    case 'skew-vertical':
      return { id, kind: 'skew', skewX: 0, skewY: 20, origin: C(0.5, 0.5) };
    case 'perspective-left':
      return {
        id,
        kind: 'perspective',
        corners: CORNERS(C(0.15, 0.08), C(1, 0), C(1, 1), C(0.15, 0.92)),
      };
    case 'perspective-right':
      return {
        id,
        kind: 'perspective',
        corners: CORNERS(C(0, 0), C(0.85, 0.08), C(0.85, 0.92), C(0, 1)),
      };
    case 'arc-up':
      return { id, kind: 'bend', mode: 'arc', amount: 0.6, axis: 'horizontal', origin: 0.5 };
    case 'arc-down':
      return { id, kind: 'bend', mode: 'arc', amount: -0.6, axis: 'horizontal', origin: 0.5 };
    case 'arch':
      return { id, kind: 'bend', mode: 'arch', amount: 0.6, axis: 'horizontal', origin: 0.5 };
    case 'shell':
      return { id, kind: 'bend', mode: 'shell', amount: 0.7, axis: 'horizontal', origin: 0.5 };
    case 'bulge':
      return { id, kind: 'bend', mode: 'bulge', amount: 0.7, axis: 'horizontal', origin: 0.5 };
    case 'pinch':
      return { id, kind: 'bend', mode: 'bulge', amount: -0.7, axis: 'horizontal', origin: 0.5 };
    case 'flag':
      return {
        id,
        kind: 'bend',
        mode: 'flag',
        amount: 0.7,
        axis: 'horizontal',
        origin: 0.5,
        wavelength: 1,
      };
    case 'wave':
      return {
        id,
        kind: 'bend',
        mode: 'wave',
        amount: 0.6,
        axis: 'horizontal',
        origin: 0.5,
        wavelength: 2,
      };
    case 'rise':
      return { id, kind: 'bend', mode: 'rise', amount: 0.6, axis: 'horizontal', origin: 0.5 };
    case 'four-corner':
      return {
        id,
        kind: 'perspective',
        corners: CORNERS(C(0.08, 0.06), C(0.92, 0.1), C(0.9, 0.94), C(0.1, 0.9)),
      };
    case 'four-edge':
      return {
        id,
        kind: 'envelope',
        corners: CORNERS(C(0, 0), C(1, 0), C(1, 1), C(0, 1)),
        edges: {
          top: [C(0.28, -0.1), C(0.72, -0.1)],
          right: [C(1.1, 0.3), C(1.08, 0.7)],
          bottom: [C(0.3, 1.08), C(0.7, 1.08)],
          left: [C(-0.1, 0.3), C(-0.08, 0.7)],
        },
        interpolation: 'coons',
      };
    case 'mesh-4x4': {
      const rows = 4;
      const columns = 4;
      const points: Array<{ x: number; y: number }> = [];
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= columns; c++) {
          points.push({ x: c / columns, y: r / rows });
        }
      }
      return { id, kind: 'mesh-warp', rows, columns, points, interpolation: 'bilinear' };
    }
  }
}

/** Preset → bend parameters for the Inspector (display only). */
export function bendForPreset(kind: WarpPresetKind): { mode: BendMode; amount: number } | null {
  switch (kind) {
    case 'arc-up':
      return { mode: 'arc', amount: 0.6 };
    case 'arc-down':
      return { mode: 'arc', amount: -0.6 };
    case 'arch':
      return { mode: 'arch', amount: 0.6 };
    case 'shell':
      return { mode: 'shell', amount: 0.7 };
    case 'bulge':
      return { mode: 'bulge', amount: 0.7 };
    case 'pinch':
      return { mode: 'bulge', amount: -0.7 };
    case 'flag':
      return { mode: 'flag', amount: 0.7 };
    case 'wave':
      return { mode: 'wave', amount: 0.6 };
    case 'rise':
      return { mode: 'rise', amount: 0.6 };
    default:
      return null;
  }
}

// ── deterministic fitting ──────────────────────────────────────────────────

/** Normalize a world-space quad against a source bounds rect. */
export function perspectiveFromQuad(
  quad: readonly [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ],
  bounds: WarpRect,
): PerspectiveModifier | null {
  if (bounds.w === 0 || bounds.h === 0) return null;
  const norm = (p: { x: number; y: number }) =>
    C((p.x - bounds.x) / bounds.w, (p.y - bounds.y) / bounds.h);
  const corners = CORNERS(norm(quad[0]), norm(quad[1]), norm(quad[2]), norm(quad[3]));
  return { id: nextWarpModifierId(), kind: 'perspective', corners };
}

/**
 * Fit a cubic envelope edge to an existing path ring.
 *
 * Deterministic least-squares cubic fit over normalized samples of the
 * target ring, mapped into the source bounds. The returned modifier keeps
 * the opposite edges straight so the envelope is well-formed, and reports
 * an RMS fit error (normalized units) as a bounded-approximation metric.
 *
 * Edge mapping: the ring is sampled by arc-length-ish parameter; the edge
 * region closest to the requested side of the source bounds is selected.
 */
export function fitEnvelopeFromPath(
  ring: PathPoint[],
  bounds: WarpRect,
  edge: 'top' | 'right' | 'bottom' | 'left',
): { modifier: EnvelopeModifier; fitError: number } {
  if (ring.length < 2 || bounds.w === 0 || bounds.h === 0) {
    return {
      modifier: identityEnvelope(),
      fitError: 1,
    };
  }
  // Sample the ring densely (source-local → normalized).
  const samples: Array<{ x: number; y: number }> = [];
  const n = ring.length;
  const step = 64;
  for (let i = 0; i <= step; i++) {
    const t = (i / step) * n;
    const a = ring[Math.min(n - 1, Math.floor(t)) % n]!;
    const b = ring[Math.min(n - 1, Math.ceil(t)) % n]!;
    const f = t % 1;
    samples.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }

  // Pick the samples on the requested side of the bounds center.
  const side = (p: { x: number; y: number }): number => {
    switch (edge) {
      case 'top':
        return bounds.y + bounds.h / 2 - p.y;
      case 'bottom':
        return p.y - (bounds.y + bounds.h / 2);
      case 'left':
        return bounds.x + bounds.w / 2 - p.x;
      case 'right':
        return p.x - (bounds.x + bounds.w / 2);
    }
  };
  const bySide = samples.filter((p) => side(p) >= 0);
  const chosen = bySide.length >= 4 ? bySide : samples;

  // Normalize chosen samples into the source bounds.
  const normalized = chosen
    .map((p) => ({
      x: (p.x - bounds.x) / bounds.w,
      y: (p.y - bounds.y) / bounds.h,
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  if (normalized.length < 4) {
    return { modifier: identityEnvelope(), fitError: 1 };
  }

  // Sort along the dominant axis of the edge.
  const horizontalEdge = edge === 'top' || edge === 'bottom';
  normalized.sort((a, b) => (horizontalEdge ? a.x - b.x : a.y - b.y));

  // Endpoints fixed to the bounds corners; interior controls from
  // least-squares fit of the cubic basis with endpoint constraints.
  const p0 = horizontalEdge ? C(0, edge === 'top' ? 0 : 1) : C(edge === 'left' ? 0 : 1, 0);
  const p3 = horizontalEdge ? C(1, edge === 'top' ? 0 : 1) : C(edge === 'left' ? 0 : 1, 1);
  const t = (i: number) => (normalized.length <= 1 ? 0 : i / (normalized.length - 1));
  const b0 = (ti: number) => (1 - ti) ** 3;
  const b1 = (ti: number) => 3 * (1 - ti) ** 2 * ti;
  const b2 = (ti: number) => 3 * (1 - ti) * ti ** 2;
  const b3 = (ti: number) => ti ** 3;

  // Solve for interior controls: for each sample, P(t) = b0·p0 + b1·c1 + b2·c2 + b3·p3.
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let r1x = 0;
  let r2x = 0;
  let r1y = 0;
  let r2y = 0;
  for (let i = 0; i < normalized.length; i++) {
    const s = normalized[i]!;
    const ti = t(i);
    const w1 = b1(ti);
    const w2 = b2(ti);
    const residualX = s.x - (b0(ti) * p0.x + b3(ti) * p3.x);
    const residualY = s.y - (b0(ti) * p0.y + b3(ti) * p3.y);
    s11 += w1 * w1;
    s12 += w1 * w2;
    s22 += w2 * w2;
    r1x += w1 * residualX;
    r2x += w2 * residualX;
    r1y += w1 * residualY;
    r2y += w2 * residualY;
  }
  const det = s11 * s22 - s12 * s12;
  let c1 = { x: p0.x, y: p0.y };
  let c2 = { x: p3.x, y: p3.y };
  if (Math.abs(det) > 1e-12) {
    const c1x = (r1x * s22 - r2x * s12) / det;
    const c1y = (r1y * s22 - r2y * s12) / det;
    const c2x = (r2x * s11 - r1x * s12) / det;
    const c2y = (r2y * s11 - r1y * s12) / det;
    c1 = { x: c1x, y: c1y };
    c2 = { x: c2x, y: c2y };
  }
  // Clamp interior controls to a sane envelope (bounded approximation).
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  c1.x = clamp(c1.x, -2, 3);
  c1.y = clamp(c1.y, -2, 3);
  c2.x = clamp(c2.x, -2, 3);
  c2.y = clamp(c2.y, -2, 3);

  // Fit error: mean distance of normalized samples from the fitted cubic.
  let error = 0;
  for (let i = 0; i < normalized.length; i++) {
    const s = normalized[i]!;
    const ti = t(i);
    const px = b0(ti) * p0.x + b1(ti) * c1.x + b2(ti) * c2.x + b3(ti) * p3.x;
    const py = b0(ti) * p0.y + b1(ti) * c1.y + b2(ti) * c2.y + b3(ti) * p3.y;
    error += Math.hypot(s.x - px, s.y - py);
  }
  const fitError = error / Math.max(1, normalized.length);

  const identity = { x: 0, y: 0 };
  const modifier: EnvelopeModifier = {
    id: nextWarpModifierId(),
    kind: 'envelope',
    corners: CORNERS(C(0, 0), C(1, 0), C(1, 1), C(0, 1)),
    edges: {
      top: [identity, identity],
      right: [identity, identity],
      bottom: [identity, identity],
      left: [identity, identity],
    },
    interpolation: 'coons',
  };
  const interior: [NormalizedPoint, NormalizedPoint] = [c1, c2];
  switch (edge) {
    case 'top':
      modifier.corners.tl = p0;
      modifier.corners.tr = p3;
      modifier.edges.top = interior;
      break;
    case 'bottom':
      modifier.corners.bl = p0;
      modifier.corners.br = p3;
      modifier.edges.bottom = interior;
      break;
    case 'left':
      modifier.corners.tl = p0;
      modifier.corners.bl = p3;
      modifier.edges.left = interior;
      break;
    case 'right':
      modifier.corners.tr = p0;
      modifier.corners.br = p3;
      modifier.edges.right = interior;
      break;
  }
  return { modifier, fitError: Math.min(1, fitError) };
}

function identityEnvelope(): EnvelopeModifier {
  return {
    id: nextWarpModifierId(),
    kind: 'envelope',
    corners: CORNERS(C(0, 0), C(1, 0), C(1, 1), C(0, 1)),
    edges: {
      top: [C(1 / 3, 0), C(2 / 3, 0)],
      right: [C(1, 1 / 3), C(1, 2 / 3)],
      bottom: [C(1 / 3, 1), C(2 / 3, 1)],
      left: [C(0, 1 / 3), C(0, 2 / 3)],
    },
    interpolation: 'coons',
  };
}

/** Reset a modifier of the given kind to an identity configuration. */
export function makeIdentityWarpModifier(kind: WarpModifier['kind']): WarpModifier {
  switch (kind) {
    case 'skew':
      return { id: nextWarpModifierId(), kind: 'skew', skewX: 0, skewY: 0, origin: C(0.5, 0.5) };
    case 'perspective':
      return {
        id: nextWarpModifierId(),
        kind: 'perspective',
        corners: CORNERS(C(0, 0), C(1, 0), C(1, 1), C(0, 1)),
      };
    case 'envelope':
      return identityEnvelope();
    case 'mesh-warp':
      return makeWarpPreset('mesh-4x4');
    case 'bend':
      return {
        id: nextWarpModifierId(),
        kind: 'bend',
        mode: 'arch',
        amount: 0,
        axis: 'horizontal',
        origin: 0.5,
      };
    default:
      return makeWarpPreset('arch');
  }
}

/** Preset mesh builder used by tests and the Inspector's row/col changes. */
export function flatMeshPoints(rows: number, columns: number): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= columns; c++) {
      points.push({ x: c / columns, y: r / rows });
    }
  }
  return points;
}
