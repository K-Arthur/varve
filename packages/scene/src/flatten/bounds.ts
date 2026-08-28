/**
 * Flatten bounds calculation — computes world-space bounding boxes for
 * node selections, including effect overflow (blur, shadow, glow spread).
 *
 * Pure module: no canvas, engine, or DOM dependencies. Lives in @varve/scene
 * so both @varve/engine and @varve/editor can use it without circular deps.
 *
 * Research basis: bounding-box expansion for visual effects (Photoshop
 * canvas-size handles, Illustrator "Rasterize" bounds with effect padding).
 */

import { nodeWorldBounds } from '../coordinateService';
import { type Document, getParent } from '../document';
import type { NodeId } from '../types';
import type { BoundsRect } from './types';

export { insertFlattenedCopy, mergeNodes, replaceNodesWithFlattened } from './flattenOps';

/** Compute the pixel expansion for a single effect in all four directions. */
export function effectPadding(effect: {
  type: string;
  blur?: number;
  spread?: number;
  blurStrength?: number;
  x?: number;
  y?: number;
  radius?: number;
}): { left: number; top: number; right: number; bottom: number } {
  const blur = effect.blur ?? 0;
  const spread = effect.spread ?? 0;
  const offsetX = effect.x ?? 0;
  const offsetY = effect.y ?? 0;
  const radius = effect.radius ?? 0;
  const depthBlurRadius = effect.blurStrength ?? 0;

  // Conservative blur-kernel extent. The Canvas2D shadow API and CSS blur
  // filters visibly spread ≈3× the radius, and the replay buffer pads by
  // `blur * 3 + max(0, spread) / 2`. Export/invalidation bounds must at
  // least match that or shadows get clipped at the edge.
  const kernel = Math.max(0, blur) * 3 + Math.max(0, spread) / 2;
  const radiusKernel = Math.max(0, radius) * 3;

  switch (effect.type) {
    case 'dropShadow': {
      const left = kernel + Math.max(0, -offsetX);
      const top = kernel + Math.max(0, -offsetY);
      const right = kernel + Math.max(0, offsetX);
      const bottom = kernel + Math.max(0, offsetY);
      return { left, top, right, bottom };
    }
    case 'innerShadow':
    case 'innerGlow':
      // Inset effects are composited clipped to the shape interior; they
      // never extend the object's visual bounds.
      return { left: 0, top: 0, right: 0, bottom: 0 };
    case 'outerGlow':
      return { left: kernel, top: kernel, right: kernel, bottom: kernel };
    case 'layerBlur':
    case 'backgroundBlur':
      return {
        left: radiusKernel,
        top: radiusKernel,
        right: radiusKernel,
        bottom: radiusKernel,
      };
    case 'depthBlur':
      return {
        left: depthBlurRadius * 3,
        top: depthBlurRadius * 3,
        right: depthBlurRadius * 3,
        bottom: depthBlurRadius * 3,
      };
    case 'glassMaterial':
      return { left: kernel, top: kernel, right: kernel, bottom: kernel };
    case 'chromaticAberration':
    case 'glitch':
      return { left: 0, top: 0, right: 0, bottom: 0 };
    default:
      return { left: 0, top: 0, right: 0, bottom: 0 };
  }
}

/** Sum padding across all visible effects on a node. */
export function nodeEffectPadding(node: { effects?: Array<Record<string, unknown>> }): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;

  for (const effect of node.effects ?? []) {
    if (effect.visible === false) continue;
    const p = effectPadding(effect as Parameters<typeof effectPadding>[0]);
    left = Math.max(left, p.left);
    top = Math.max(top, p.top);
    right = Math.max(right, p.right);
    bottom = Math.max(bottom, p.bottom);
  }

  return { left, top, right, bottom };
}

/**
 * Compute world-space bounds for a set of nodes, including effect overflow.
 * Returns null if no valid bounds could be computed.
 */
export function computeFlattenBounds(
  doc: Document,
  nodeIds: readonly NodeId[],
  includeEffectOverflow = true,
): BoundsRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of nodeIds) {
    const node = doc.nodes[id];
    if (!node) continue;
    if (node.visible === false) continue;

    const worldBounds = nodeWorldBounds(doc, id);
    if (!worldBounds) continue;

    let padLeft = 0;
    let padTop = 0;
    let padRight = 0;
    let padBottom = 0;

    if (includeEffectOverflow && 'effects' in node) {
      const padding = nodeEffectPadding(node as { effects?: Array<Record<string, unknown>> });
      padLeft = padding.left;
      padTop = padding.top;
      padRight = padding.right;
      padBottom = padding.bottom;
    }

    minX = Math.min(minX, worldBounds.x - padLeft);
    minY = Math.min(minY, worldBounds.y - padTop);
    maxX = Math.max(maxX, worldBounds.x + worldBounds.w + padRight);
    maxY = Math.max(maxY, worldBounds.y + worldBounds.h + padBottom);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  return {
    x: minX,
    y: minY,
    w: Math.max(maxX - minX, 1),
    h: Math.max(maxY - minY, 1),
  };
}

/** Compute the common ancestor for a set of node IDs. */
export function findCommonAncestor(doc: Document, nodeIds: readonly NodeId[]): NodeId | null {
  if (nodeIds.length === 0) return null;
  if (nodeIds.length === 1) {
    return getParent(doc, nodeIds[0]!);
  }

  const ancestors = (id: NodeId): NodeId[] => {
    const chain: NodeId[] = [];
    let current: NodeId | null = id;
    const visited = new Set<NodeId>();
    while (current && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      current = getParent(doc, current);
    }
    return chain;
  };

  const firstChain = ancestors(nodeIds[0]!);
  const firstSet = new Set(firstChain);

  let deepest: NodeId | null = null;
  let shallowestDepth = Infinity;
  for (let i = 1; i < nodeIds.length; i++) {
    const chain = ancestors(nodeIds[i]!);
    for (let depth = 0; depth < chain.length; depth++) {
      const ancestor = chain[depth]!;
      if (firstSet.has(ancestor) && depth < shallowestDepth) {
        deepest = ancestor;
        shallowestDepth = depth;
      }
    }
  }

  return deepest;
}
