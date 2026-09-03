/**
 * Canonical geometry for spatial gradients.
 *
 * An explicit gradient transform maps the unit fill square to the node's
 * local coordinate space.  The canonical linear handles are `[0, 0.5]` and
 * `[1, 0.5]`; a radial field is centred at `[0.5, 0.5]` and its two affine
 * axes terminate at `[1, 0.5]` and `[0.5, 1]`.  Keeping this small contract
 * in @varve/shared prevents the editor, renderer, and exporters from
 * inventing incompatible "centre + angle + radius" interpretations.
 */

import type { Affine, Point, Rect } from './affine';
import { applyAffine, multiplyAffine } from './affine';

/** The spatial fields used by a scene or engine gradient. */
export interface GradientGeometrySource {
  rotation?: number;
  transform?: Affine;
}

export interface LinearGradientHandles {
  start: Point;
  end: Point;
}

export interface RadialGradientHandles {
  center: Point;
  /** End of the transformed +u radius (the primary radial handle). */
  uAxisEnd: Point;
  /** End of the transformed +v radius (the secondary radial handle). */
  vAxisEnd: Point;
}

const LINEAR_START: Point = [0, 0.5];
const LINEAR_END: Point = [1, 0.5];
const RADIAL_CENTER: Point = [0.5, 0.5];
const RADIAL_U_AXIS_END: Point = [1, 0.5];
const RADIAL_V_AXIS_END: Point = [0.5, 1];

/**
 * Materialize the historic bounds-and-rotation renderer behaviour as a full
 * affine fill transform.  This is intentionally lazy: legacy documents keep
 * their rotation-only representation until an operation needs explicit fill
 * geometry (a bake or direct handle edit).
 */
export function materializeLegacyGradientTransform(bounds: Rect, rotation = 0): Affine {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const radius = Math.hypot(bounds.w, bounds.h) / 2;
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;

  // G = T(center) · R(rotation) · S(2r, 2r) · T(-0.5, -0.5).
  // It maps the legacy linear endpoints exactly, while also materializing the
  // matching circular radial field for the radial renderer.
  return [
    2 * radius * cos,
    2 * radius * sin,
    -2 * radius * sin,
    2 * radius * cos,
    cx - radius * cos + radius * sin,
    cy - radius * sin - radius * cos,
  ];
}

/** Return the authoritative unit-fill → node-local matrix for a gradient. */
export function gradientTransformForBounds(gradient: GradientGeometrySource, bounds: Rect): Affine {
  return gradient.transform ?? materializeLegacyGradientTransform(bounds, gradient.rotation ?? 0);
}

/** Derive the two linear-gradient geometry handles in node-local coordinates. */
export function linearGradientHandles(
  gradient: GradientGeometrySource,
  bounds: Rect,
): LinearGradientHandles {
  const transform = gradientTransformForBounds(gradient, bounds);
  return {
    start: applyAffine(transform, LINEAR_START),
    end: applyAffine(transform, LINEAR_END),
  };
}

/** Derive centre and both affine axes for a radial gradient in node-local coordinates. */
export function radialGradientHandles(
  gradient: GradientGeometrySource,
  bounds: Rect,
): RadialGradientHandles {
  const transform = gradientTransformForBounds(gradient, bounds);
  return {
    center: applyAffine(transform, RADIAL_CENTER),
    uAxisEnd: applyAffine(transform, RADIAL_U_AXIS_END),
    vAxisEnd: applyAffine(transform, RADIAL_V_AXIS_END),
  };
}

/**
 * The orientation of the canonical +u fill axis, in normalized degrees.
 * This is only a UI presentation value; the affine matrix remains the source
 * of truth for a gradient's complete geometry.
 */
export function gradientRotationForBounds(gradient: GradientGeometrySource, bounds: Rect): number {
  const transform = gradientTransformForBounds(gradient, bounds);
  return ((Math.atan2(transform[1], transform[0]) * 180) / Math.PI + 360) % 360;
}

/**
 * Set the presentation rotation by rotating the full fill field about its
 * centre. This preserves an authored radial ellipse/skew and materializes a
 * legacy rotation-only value when the inspector is edited.
 */
export function setGradientRotation<T extends GradientGeometrySource>(
  gradient: T,
  bounds: Rect,
  rotation: number,
): Omit<T, 'rotation'> & { transform: Affine; rotation?: never } {
  const transform = gradientTransformForBounds(gradient, bounds);
  const currentRadians = Math.atan2(transform[1], transform[0]);
  const targetRadians = (rotation * Math.PI) / 180;
  const delta = targetRadians - currentRadians;
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  const center = applyAffine(transform, RADIAL_CENTER);
  const rotateAroundCenter: Affine = [
    cos,
    sin,
    -sin,
    cos,
    center[0] - cos * center[0] + sin * center[1],
    center[1] - sin * center[0] - cos * center[1],
  ];
  const { rotation: _legacyRotation, ...withoutLegacyRotation } = gradient;
  return {
    ...withoutLegacyRotation,
    transform: multiplyAffine(rotateAroundCenter, transform),
  };
}

/**
 * Apply a baked node-local geometry transform to a linked gradient.
 *
 * The result is `B · G`: points first flow through the gradient's unit-fill
 * transform and then through the same local transform that was written into
 * the vector geometry.  A rotation-only legacy gradient is materialized just
 * in time, preserving its pre-bake appearance instead of re-deriving it from
 * the resized bounds.
 */
export function transformLinkedGradient<T extends GradientGeometrySource>(
  gradient: T,
  boundsBeforeBake: Rect,
  geometryTransform: Affine,
): T & { transform: Affine } {
  return {
    ...gradient,
    transform: multiplyAffine(
      geometryTransform,
      gradientTransformForBounds(gradient, boundsBeforeBake),
    ),
  };
}
