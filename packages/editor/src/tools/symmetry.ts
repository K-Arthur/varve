/**
 * Painting symmetry.
 *
 * Symmetry is expressed as a set of coordinate transforms applied to the
 * *input* stroke, not as a duplicated brush tool. Each transform produces one
 * independent engine stroke that runs through the same brush pipeline, so
 * mirrored copies automatically inherit pressure dynamics, grain, alpha lock
 * and selection clipping instead of needing a parallel implementation.
 *
 * Transforms carry direction as well as position: a mirrored dab whose
 * direction was not reflected would rotate the wrong way under directional
 * grain or a non-round tip, which is the usual giveaway that symmetry was
 * bolted on by copying x/y only.
 */
import type { StrokePoint } from '@varve/scene';

export type SymmetryMode = 'none' | 'mirrorX' | 'mirrorY' | 'mirrorXY' | 'radial';

export interface SymmetrySettings {
  mode: SymmetryMode;
  /** Axis origin in the target layer's pixel space. */
  originX: number;
  originY: number;
  /** Axis rotation in radians (mirror modes). */
  angle: number;
  /** Number of rotational segments for radial mode. */
  radialCount: number;
  /** Also mirror each radial segment, giving kaleidoscope symmetry. */
  radialMirror?: boolean;
  visible?: boolean;
}

/**
 * Upper bound on symmetry copies.
 *
 * Every copy multiplies dab count, dirty area and worker traffic, so a large
 * brush at an unbounded segment count can wedge the app. 32 is past the point
 * of visual usefulness and keeps the worst case bounded.
 */
export const MAX_RADIAL_SEGMENTS = 32;

export function defaultSymmetrySettings(): SymmetrySettings {
  return {
    mode: 'none',
    originX: 0,
    originY: 0,
    angle: 0,
    radialCount: 6,
    radialMirror: false,
    visible: true,
  };
}

export interface SymmetryPoint {
  x: number;
  y: number;
  direction: number;
}

export type SymmetryTransform = (p: SymmetryPoint) => SymmetryPoint;

const IDENTITY: SymmetryTransform = (p) => p;

/**
 * Resolve settings into the transforms to run. The first entry is always the
 * identity, so the user's own stroke is branch 0 and disabling symmetry is
 * exactly "one branch" rather than a separate code path.
 */
export function resolveSymmetryTransforms(
  settings: SymmetrySettings | null | undefined,
): SymmetryTransform[] {
  if (!settings || settings.mode === 'none') return [IDENTITY];
  const { originX: ox, originY: oy, angle } = settings;

  switch (settings.mode) {
    case 'mirrorX':
      return [IDENTITY, mirrorAbout(ox, oy, angle)];
    case 'mirrorY':
      return [IDENTITY, mirrorAbout(ox, oy, angle + Math.PI / 2)];
    case 'mirrorXY':
      return [
        IDENTITY,
        mirrorAbout(ox, oy, angle),
        mirrorAbout(ox, oy, angle + Math.PI / 2),
        rotateAbout(ox, oy, Math.PI),
      ];
    case 'radial': {
      const count = clampRadialCount(settings.radialCount);
      const transforms: SymmetryTransform[] = [];
      for (let i = 0; i < count; i++) {
        const theta = (i * 2 * Math.PI) / count;
        transforms.push(i === 0 ? IDENTITY : rotateAbout(ox, oy, theta));
        if (settings.radialMirror) {
          transforms.push(compose(rotateAbout(ox, oy, theta), mirrorAbout(ox, oy, angle)));
        }
      }
      return transforms;
    }
    default:
      return [IDENTITY];
  }
}

export function clampRadialCount(count: number): number {
  if (!Number.isFinite(count)) return 2;
  return Math.max(2, Math.min(MAX_RADIAL_SEGMENTS, Math.round(count)));
}

/** How many strokes a settings object will produce. */
export function symmetryBranchCount(settings: SymmetrySettings | null | undefined): number {
  return resolveSymmetryTransforms(settings).length;
}

/** Apply a transform to a full stroke point, preserving its dynamics. */
export function transformStrokePoint(
  point: StrokePoint,
  transform: SymmetryTransform,
): StrokePoint {
  const mapped = transform({ x: point.x, y: point.y, direction: point.direction });
  if (mapped.x === point.x && mapped.y === point.y && mapped.direction === point.direction) {
    return point;
  }
  return { ...point, x: mapped.x, y: mapped.y, direction: mapped.direction };
}

/** Reflection across the line through (ox, oy) at `angle`. */
function mirrorAbout(ox: number, oy: number, angle: number): SymmetryTransform {
  const cos2 = Math.cos(2 * angle);
  const sin2 = Math.sin(2 * angle);
  return (p) => {
    const dx = p.x - ox;
    const dy = p.y - oy;
    return {
      x: ox + dx * cos2 + dy * sin2,
      y: oy + dx * sin2 - dy * cos2,
      // A reflected heading is mirrored about the same axis, not negated.
      direction: 2 * angle - p.direction,
    };
  };
}

/** Rotation by `theta` about (ox, oy). */
function rotateAbout(ox: number, oy: number, theta: number): SymmetryTransform {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return (p) => {
    const dx = p.x - ox;
    const dy = p.y - oy;
    return {
      x: ox + dx * cos - dy * sin,
      y: oy + dx * sin + dy * cos,
      direction: p.direction + theta,
    };
  };
}

function compose(outer: SymmetryTransform, inner: SymmetryTransform): SymmetryTransform {
  return (p) => outer(inner(p));
}
