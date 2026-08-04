/**
 * Conservative world-space bounds for every pixel Canvas 2D may emit.
 *
 * Canvas shadow/blur kernels are implementation-defined at their fringe, so
 * three blur radii are retained. This matches the renderer's layer-blur
 * allocation policy and avoids culling or dirty-redraw seams across engines.
 *
 * Bounds taxonomy (Phase 5):
 *   - local geometry bounds  — the shape's own box, no styling (nodeWorldBounds)
 *   - local render bounds    — geometry + strokes (miter spikes, arrowheads),
 *                              effects (shadow/blur kernels) and glyph overhang
 *   - world render bounds    — local render bounds transformed to world space,
 *                              scaled by the transform's max axis scale
 *   - viewport-space render  — world render bounds projected through the camera
 *     bounds                   (done by the paint path, not here)
 *
 * Stroke expansion is shape-aware: rect/frame corners are at most 90°, so
 * their miter extension is bounded by ~1× weight; general paths get the full
 * Canvas2D cap `weight × (miterLimit − 0.5)`. Arrowheads (line/arrow shapes)
 * add up to 6× weight past the endpoints. Text gets a font-size-proportional
 * glyph margin (italic slant, side bearings, letter-spacing — fillText never
 * clips glyphs horizontally).
 *
 * Research basis: WHATWG Canvas 2D shadows + miter limits; CSS Filter Effects
 * blur expansion; Strata's portable cross-engine Canvas 2D safety policy.
 */

import type { Document, Effect, NodeId, SceneNode } from '@varve/scene';
import { resolveAllStyles } from '@varve/scene';
import type { Affine, Rect } from '@varve/shared';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';

export type Appearance = Pick<SceneNode, 'transform'> & {
  kind?: string;
  shape?: { kind?: string };
  cornerRadius?: number | readonly [number, number, number, number];
  fontSize?: number;
  letterSpacing?: number;
  strokes?: readonly {
    visible?: boolean;
    weight: number;
    align: 'inside' | 'center' | 'outside';
    perSideWeights?: readonly number[];
    join?: 'miter' | 'round' | 'bevel';
    miterLimit?: number;
    arrowStart?: import('@varve/scene').ArrowheadStyle;
    arrowEnd?: import('@varve/scene').ArrowheadStyle;
  }[];
  effects?: readonly Effect[];
};

export function expandRect(rect: Rect, padding: number): Rect {
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return {
    x: rect.x - safePadding,
    y: rect.y - safePadding,
    w: rect.w + safePadding * 2,
    h: rect.h + safePadding * 2,
  };
}

/**
 * True for shape kinds whose outline has interior joins where a miter spike
 * can extend past the geometric bounds. Rects/frames are special-cased: their
 * corners are at most 90° (or rounded), so their miter extension is bounded
 * by half the stroke width. Circles, ellipses and lines have no joins.
 */
function shapeHasMiterJoins(
  shapeKind: string | undefined,
  cornerRadius?: number | readonly [number, number, number, number],
): boolean {
  if (shapeKind === 'rect' || shapeKind === 'frame') {
    if (typeof cornerRadius === 'number') return cornerRadius <= 0;
    if (Array.isArray(cornerRadius)) return cornerRadius.every((r) => r <= 0);
    return true;
  }
  return shapeKind === 'path' || shapeKind === 'polygon' || shapeKind === 'star';
}

/** Outward local-space footprint for strokes and effects. */
export function appearancePaddingLocal(appearance: Appearance): number {
  let padding = 0;
  const shapeKind = appearance.shape?.kind ?? appearance.kind;
  const cornerRadius = (appearance as { cornerRadius?: number }).cornerRadius;
  for (const stroke of appearance.strokes ?? []) {
    if (stroke.visible === false) continue;
    const weight = stroke.perSideWeights?.length
      ? Math.max(...stroke.perSideWeights)
      : stroke.weight;
    const base = stroke.align === 'outside' ? weight : stroke.align === 'center' ? weight / 2 : 0;
    padding = Math.max(padding, base);
    // Miter spikes extend beyond the stroke edge at acute joins. Canvas2D
    // caps miterLength at miterLimit × strokeWidth, so the tip can reach
    // miterLimit × weight − weight/2 from the path (center alignment).
    // Rects/frames stay within ~0.91×weight; general paths get the full bound.
    if (
      stroke.align === 'center' &&
      stroke.join === 'miter' &&
      shapeHasMiterJoins(shapeKind, cornerRadius)
    ) {
      const miterLimit = Math.max(1, stroke.miterLimit ?? 4);
      if (shapeKind === 'rect' || shapeKind === 'frame') {
        padding = Math.max(padding, weight);
      } else {
        padding = Math.max(padding, weight * (miterLimit - 0.5));
      }
    }
    // Arrowheads extend past the segment endpoints: the engine draws heads up
    // to max(weight*3, 4) for path strokes and up to weight*6 for arrow
    // primitives, oriented along the segment direction.
    if (shapeKind === 'line' || shapeKind === 'arrow') {
      const hasHead =
        stroke.arrowStart !== 'none' || stroke.arrowEnd !== 'none' || shapeKind === 'arrow';
      if (hasHead) {
        padding = Math.max(padding, shapeKind === 'arrow' ? weight * 6 : Math.max(weight * 3, 4));
      }
    }
  }
  for (const effect of appearance.effects ?? []) {
    if (effect.visible === false) continue;
    switch (effect.type) {
      case 'layerBlur':
        padding = Math.max(padding, Math.max(0, effect.radius) * 3);
        break;
      case 'dropShadow':
        padding = Math.max(
          padding,
          Math.abs(effect.x) + Math.max(0, effect.blur) * 3 + Math.max(0, effect.spread),
          Math.abs(effect.y) + Math.max(0, effect.blur) * 3 + Math.max(0, effect.spread),
        );
        break;
      case 'outerGlow':
        padding = Math.max(padding, Math.max(0, effect.blur) * 3 + Math.max(0, effect.spread));
        break;
      case 'backgroundBlur':
        padding = Math.max(padding, Math.max(0, effect.radius) * 3);
        break;
      case 'glassMaterial':
        padding = Math.max(
          padding,
          Math.max(0, effect.blur) * 3 + (effect.edgeHighlight ? effect.edgeHighlightWidth : 0),
        );
        break;
      default:
        break;
    }
  }
  // Text glyphs can overhang the measured box (italic slant, side bearings,
  // letter-spacing). A font-size-proportional margin covers all of these;
  // canvas fillText never clips glyphs horizontally.
  if (appearance.kind === 'text') {
    const fontSize = Math.max(0, appearance.fontSize ?? 16);
    const spacing = Math.max(0, appearance.letterSpacing ?? 0);
    padding = Math.max(padding, fontSize * 0.2 + spacing, 2);
  }
  return padding;
}

export function appearancePaddingWorld(appearance: Appearance, transform: Affine): number {
  const [a, b, c, d] = transform;
  const scale = Math.max(Math.hypot(a, b), Math.hypot(c, d), 1);
  return appearancePaddingLocal(appearance) * scale;
}

/** Geometry plus resolved reusable-style effects/strokes in world space. */
export function nodeVisualWorldBounds(
  document: Document,
  nodeId: NodeId,
  resolvedStyles = resolveAllStyles(document),
  parentIndex?: Map<NodeId, NodeId>,
): Rect | null {
  const node = document.nodes[nodeId];
  const geometry = nodeWorldBounds(document, nodeId, parentIndex);
  if (!node || !geometry) return geometry;
  const resolved = resolvedStyles.get(nodeId);
  const appearance = resolved ? ({ ...node, ...resolved } as SceneNode) : node;
  return expandRect(
    geometry,
    appearancePaddingWorld(
      appearance as Appearance,
      nodeWorldTransform(document, nodeId, parentIndex),
    ),
  );
}
