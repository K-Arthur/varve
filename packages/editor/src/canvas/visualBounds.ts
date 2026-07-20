/**
 * Conservative world-space bounds for every pixel Canvas 2D may emit.
 *
 * Canvas shadow/blur kernels are implementation-defined at their fringe, so
 * three blur radii are retained. This matches the renderer's layer-blur
 * allocation policy and avoids culling or dirty-redraw seams across engines.
 *
 * Research basis: WHATWG Canvas 2D shadows; CSS Filter Effects blur expansion;
 * Strata's portable cross-engine Canvas 2D safety policy (2026-07-13).
 */

import type { Document, Effect, NodeId, SceneNode } from '@strata/scene';
import { resolveAllStyles } from '@strata/scene';
import type { Affine, Rect } from '@strata/shared';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';

type Appearance = Pick<SceneNode, 'transform'> & {
  strokes?: readonly {
    visible?: boolean;
    weight: number;
    align: 'inside' | 'center' | 'outside';
    perSideWeights?: readonly number[];
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

/** Maximum outward local-space footprint for strokes and effects. */
export function appearancePaddingLocal(appearance: Appearance): number {
  let padding = 0;
  for (const stroke of appearance.strokes ?? []) {
    if (stroke.visible === false) continue;
    const weight = stroke.perSideWeights?.length
      ? Math.max(...stroke.perSideWeights)
      : stroke.weight;
    padding = Math.max(
      padding,
      stroke.align === 'outside' ? weight : stroke.align === 'center' ? weight / 2 : 0,
    );
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
): Rect | null {
  const node = document.nodes[nodeId];
  const geometry = nodeWorldBounds(document, nodeId);
  if (!node || !geometry) return geometry;
  const resolved = resolvedStyles.get(nodeId);
  const appearance = resolved ? ({ ...node, ...resolved } as SceneNode) : node;
  return expandRect(
    geometry,
    appearancePaddingWorld(appearance as Appearance, nodeWorldTransform(document, nodeId)),
  );
}
