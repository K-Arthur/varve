/**
 * Isometric lattice snapping.
 *
 * Integrated into the shared `snapPosition` solver rather than bolted onto
 * individual tools. Two distinct behaviours:
 *
 * - **intersection snapping**: the nearest lattice *point*, found exactly in
 *   2-D (never by independently rounding oblique coordinates — see
 *   `@varve/scene` `nearestLatticePoint`).
 * - **line snapping**: the nearest line of an authored family, corrected
 *   perpendicular to that family.
 *
 * Both produce a single translation for the whole moved selection. The
 * caller applies it once, so relative arrangement is preserved and
 * descendants are never moved twice.
 *
 * Sticky acquisition/release is expressed on the *raw* feature position, so
 * a corrected result is never fed back as its own input.
 */

import type { AxisFamily, Basis, Vec2 } from '@varve/scene';
import { nearestLatticeLine, nearestLatticePoint } from '@varve/scene';

export interface IsometricSnapTarget {
  /** Stable identity for lock invalidation (grid id + geometry revision). */
  id: string;
  /** Lattice origin in document space. */
  origin: Vec2;
  /** Lattice basis columns (axis steps) in document space. */
  basis: Basis;
  /** Authored line families eligible for line snapping. */
  families: readonly AxisFamily[];
  /** Snap to lattice intersections. */
  intersections: boolean;
  /** Snap to family lines. */
  lines: boolean;
  /** Acquisition distance in document units. */
  maxDistance: number;
  /** Release distance in document units (>= maxDistance for hysteresis). */
  releaseDistance: number;
  /** Previous lock from the same gesture, if any. */
  previous?: IsometricSnapLock | null;
}

export interface IsometricSnapLock {
  targetId: string;
  kind: 'intersection' | 'line';
  familyIndex: number;
  /** Lattice indices for intersection locks. */
  index?: readonly [number, number];
  /** Feature that acquired the lock. */
  featureIndex: number;
  /** Snapped world position of the feature at acquisition. */
  snapped: Vec2;
}

export interface IsometricSnapResult {
  /** Translation to apply to the whole selection. */
  translation: { x: number; y: number };
  /** World position of the winning source feature. */
  sourcePoint: Vec2;
  /** World position after snapping. */
  snappedPoint: Vec2;
  kind: 'intersection' | 'line';
  familyIndex?: number;
  distance: number;
  lock: IsometricSnapLock;
}

export interface IsometricSnapCandidate {
  kind: 'intersection' | 'line';
  familyIndex: number;
  snappedPoint: Vec2;
  distance: number;
  index?: readonly [number, number];
}

/**
 * Candidate snap for a single source feature. Exported for tests; the
 * selection-level entry point is {@link findIsometricSnap}.
 */
export function isometricCandidatesForPoint(
  point: Vec2,
  target: Pick<IsometricSnapTarget, 'origin' | 'basis' | 'families' | 'intersections' | 'lines'>,
): IsometricSnapCandidate[] {
  const candidates: IsometricSnapCandidate[] = [];
  if (target.intersections) {
    const hit = nearestLatticePoint(point, target.basis, { origin: target.origin });
    if (hit) {
      candidates.push({
        kind: 'intersection',
        familyIndex: -1,
        snappedPoint: hit.point,
        distance: hit.distance,
        index: hit.index,
      });
    }
  }
  if (target.lines) {
    for (const family of target.families) {
      if (family.role !== 'lattice') continue;
      const hit = nearestLatticeLine(point, target.origin, family);
      if (hit) {
        candidates.push({
          kind: 'line',
          familyIndex: family.index,
          snappedPoint: hit.point,
          distance: hit.distance,
        });
      }
    }
  }
  return candidates;
}

/**
 * Find the best single translation for a set of source features (selection
 * corners, edge midpoints, centre). Returns `null` when nothing is within
 * the acquisition distance.
 *
 * Determinism: features are scanned in order and a candidate must be
 * *strictly* closer to displace an earlier one; intersections are listed
 * before lines, and families in authored order. Ties therefore resolve
 * identically for identical inputs.
 */
export function findIsometricSnap(
  features: readonly Vec2[],
  target: IsometricSnapTarget,
): IsometricSnapResult | null {
  if (!Number.isFinite(target.maxDistance) || target.maxDistance <= 0 || features.length === 0) {
    return null;
  }

  // Sticky: keep the acquired lattice target while the raw feature remains
  // inside the release radius. The current feature position is used, so the
  // translation follows the pointer without ever feeding back a corrected
  // coordinate.
  const previous = target.previous;
  if (previous && previous.targetId === target.id) {
    const feature = features[previous.featureIndex];
    if (feature) {
      const distance = Math.hypot(
        feature[0] - previous.snapped[0],
        feature[1] - previous.snapped[1],
      );
      if (distance <= target.releaseDistance) {
        return {
          translation: {
            x: previous.snapped[0] - feature[0],
            y: previous.snapped[1] - feature[1],
          },
          sourcePoint: feature,
          snappedPoint: previous.snapped,
          kind: previous.kind,
          familyIndex: previous.familyIndex >= 0 ? previous.familyIndex : undefined,
          distance,
          lock: previous,
        };
      }
    }
  }

  let best: IsometricSnapResult | null = null;
  let bestFeatureIndex = -1;
  let bestCandidate: IsometricSnapCandidate | null = null;
  for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
    const feature = features[featureIndex]!;
    if (!Number.isFinite(feature[0]) || !Number.isFinite(feature[1])) continue;
    const candidates = isometricCandidatesForPoint(feature, target);
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.distance) || candidate.distance > target.maxDistance) continue;
      if (!best || candidate.distance < best.distance - 1e-12) {
        best = {
          translation: {
            x: candidate.snappedPoint[0] - feature[0],
            y: candidate.snappedPoint[1] - feature[1],
          },
          sourcePoint: feature,
          snappedPoint: candidate.snappedPoint,
          kind: candidate.kind,
          familyIndex: candidate.familyIndex >= 0 ? candidate.familyIndex : undefined,
          distance: candidate.distance,
          lock: {
            targetId: target.id,
            kind: candidate.kind,
            familyIndex: candidate.familyIndex,
            ...(candidate.index ? { index: candidate.index } : {}),
            featureIndex,
            snapped: candidate.snappedPoint,
          },
        };
        bestFeatureIndex = featureIndex;
        bestCandidate = candidate;
      }
    }
  }

  // Rebuild the winning lock with the feature index (kept explicit so the
  // sticky branch can re-derive the translation on later events).
  if (best && bestCandidate && bestFeatureIndex >= 0) {
    best.lock = { ...best.lock, featureIndex: bestFeatureIndex };
  }
  return best;
}

/** Source features of an axis-aligned box, in deterministic order. */
export function boxSourceFeatures(box: { x: number; y: number; w: number; h: number }): Vec2[] {
  const { x, y, w, h } = box;
  const midX = x + w / 2;
  const midY = y + h / 2;
  return [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
    [midX, y],
    [x + w, midY],
    [midX, y + h],
    [x, midY],
    [midX, midY],
  ];
}

/**
 * Explicit source features for an object on an oblique plane.
 *
 * A world-axis-aligned bounding-box corner is a poor snap reference for a
 * projected parallelogram: the AABB corner is not a point of the artwork, so
 * snapping it to a lattice intersection leaves every real corner off-lattice.
 * This returns the node's own anchors (path anchors, rect corners, ellipse
 * extrema, line endpoints, polygon/star vertices) in world space, bounded and
 * deterministic. Returns `null` when the node has no useful geometry, in
 * which case the caller falls back to the selection box.
 */
export function nodeGeometryFeatures(
  node: { kind?: string; shape?: unknown },
  world: import('@varve/shared').Affine,
  maxFeatures = 16,
): Vec2[] | null {
  const shape = node.shape as
    | {
        kind: string;
        points?: Array<{ x: number; y: number }> | number;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        cx?: number;
        cy?: number;
        rx?: number;
        ry?: number;
        r?: number;
        from?: readonly [number, number];
        to?: readonly [number, number];
        radius?: number;
        sides?: number;
        outerRadius?: number;
        rotation?: number;
      }
    | undefined;
  if (!shape || typeof shape.kind !== 'string') return null;
  const toWorld = (p: readonly [number, number]): Vec2 => [
    world[0] * p[0] + world[2] * p[1] + world[4],
    world[1] * p[0] + world[3] * p[1] + world[5],
  ];

  let local: Array<readonly [number, number]> = [];
  switch (shape.kind) {
    case 'path':
      local = Array.isArray(shape.points)
        ? shape.points.map((point) => [point.x, point.y] as const)
        : [];
      break;
    case 'rect': {
      const { x = 0, y = 0, w = 0, h = 0 } = shape;
      local = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
      break;
    }
    case 'ellipse': {
      const { cx = 0, cy = 0, rx = 0, ry = 0 } = shape;
      local = [
        [cx - rx, cy],
        [cx + rx, cy],
        [cx, cy - ry],
        [cx, cy + ry],
      ];
      break;
    }
    case 'circle': {
      const { cx = 0, cy = 0, r = 0 } = shape;
      local = [
        [cx - r, cy],
        [cx + r, cy],
        [cx, cy - r],
        [cx, cy + r],
      ];
      break;
    }
    case 'line':
    case 'arrow':
      if (shape.from && shape.to) local = [shape.from, shape.to];
      break;
    case 'polygon': {
      const count = Math.max(3, Math.min(12, shape.sides ?? 3));
      const { cx = 0, cy = 0, radius = 0, rotation = 0 } = shape;
      local = Array.from({ length: count }, (_, i) => {
        const angle = rotation + (i / count) * Math.PI * 2;
        return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
      });
      break;
    }
    case 'star': {
      const declared = typeof shape.points === 'number' ? shape.points : 5;
      const count = Math.max(5, Math.min(12, declared));
      const { cx = 0, cy = 0, outerRadius = 0, rotation = 0 } = shape;
      local = Array.from({ length: count }, (_, i) => {
        const angle = rotation + (i / count) * Math.PI * 2;
        return [cx + Math.cos(angle) * outerRadius, cy + Math.sin(angle) * outerRadius] as const;
      });
      break;
    }
    default:
      return null;
  }
  if (local.length === 0) return null;
  const features = local.slice(0, maxFeatures).map(toWorld);
  return features.length > 0 ? features : null;
}
