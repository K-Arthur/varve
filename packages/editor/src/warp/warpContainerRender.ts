/**
 * Vector rendering of warped containers (groups/frames with live warps).
 *
 * A warped container is rendered by evaluating each descendant leaf's
 * geometry through the container's warp into a path (or cluster-adjusted
 * text) primitive in container-local space, then painting those items with
 * the container's world transform. This keeps the warp fully vector —
 * no rasterization, no IR changes, and the same canonical evaluator as
 * export and hit testing.
 *
 * Order of operations (documented):
 *   leaf geometry → leaf's own warp stack → affine chain to container
 *   → container warp stack → container-local path → world transform
 *
 * Text leaves inside a warped container get per-cluster affine adjustments
 * computed with the composed map M⁻¹ ∘ warp ∘ M, so they stay editable text.
 *
 * Limitations (v1, documented): text with its own warp stack inside a warped
 * container applies only the container warp; nested-clipping frames clip the
 * warped content with their straight box in container-local space; leaf
 * effects (shadows/blurs) apply after deformation in container-local space.
 */

import {
  buildWarpEvaluation,
  createClusterMeasure,
  DEFAULT_WARP_QUALITY,
  type PathPoint,
  type Primitive,
  type RenderItem,
  shapeToPathPoints,
  type WarpEvaluation,
  type WarpQualitySettings,
  warpPathRing,
  warpShapeToPath,
  warpTextToClusterAdjustments,
} from '@varve/engine';
import {
  type Document,
  localTransformToAncestor,
  type NodeId,
  nodeLocalBoundsSource,
  textNodeLocalBounds,
  warpsOnNode,
} from '@varve/scene';
import type { Rect } from '@varve/shared';
import { applyAffine, tryInvertAffine } from '@varve/shared';
import { sceneNodeToEngineNode } from '../render/sceneToEngine';

export { applyWarpToSelection } from './warpActions';

export interface WarpContainerRenderOptions {
  quality?: WarpQualitySettings;
}

export interface EvaluatedWarpItem {
  item: RenderItem;
  worldBounds: Rect | null;
}

interface EvaluatedItem {
  item: RenderItem;
  worldBounds: Rect | null;
  /** Warnings produced during evaluation (unsupported content). */
  warnings: string[];
}

/** Affine-maps a path ring (anchors and handle offsets). */
function mapRingByAffine(points: PathPoint[], m: readonly number[]): PathPoint[] {
  const a = m[0]!;
  const b = m[1]!;
  const c = m[2]!;
  const d = m[3]!;
  const e = m[4]!;
  const f = m[5]!;
  return points.map((p) => ({
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f,
    handleIn: p.handleIn
      ? [a * p.handleIn[0] + c * p.handleIn[1], b * p.handleIn[0] + d * p.handleIn[1]]
      : null,
    handleOut: p.handleOut
      ? [a * p.handleOut[0] + c * p.handleOut[1], b * p.handleOut[0] + d * p.handleOut[1]]
      : null,
  }));
}

function ringBounds(points: PathPoint[]): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.w, b.x + b.w);
  const maxY = Math.max(a.y + a.h, b.y + b.h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Evaluate every visible descendant leaf of a warped container into
 * world-transform RenderItems. Returns items plus a conservative world AABB.
 */
export function evaluateWarpedContainerItems(
  doc: Document,
  containerId: NodeId,
  options: WarpContainerRenderOptions = {},
): { items: EvaluatedItem[]; bounds: Rect | null; warnings: string[] } {
  const container = doc.nodes[containerId];
  if (!container || (container.kind !== 'group' && container.kind !== 'frame')) {
    return { items: [], bounds: null, warnings: [] };
  }
  const containerWarps = warpsOnNode(container);
  const sourceBounds = containerBoundsInLocal(doc, containerId);
  if (!sourceBounds) return { items: [], bounds: null, warnings: [] };
  const settings = (container as { warpSettings?: import('@varve/engine').WarpSettings })
    .warpSettings;
  const evalWarp = buildWarpEvaluation(containerWarps, sourceBounds, settings ? { settings } : {});
  const quality = options.quality ?? DEFAULT_WARP_QUALITY;
  const tolerance = quality.tolerance ?? DEFAULT_WARP_QUALITY.tolerance!;
  const budget = {
    maxDepth: quality.maxSubdivision ?? DEFAULT_WARP_QUALITY.maxSubdivision!,
    maxPoints: quality.maxGeneratedPoints ?? DEFAULT_WARP_QUALITY.maxGeneratedPoints!,
  };
  const warnings: string[] = [];

  const items: EvaluatedItem[] = [];
  let union: Rect | null = null;

  const walk = (nodeId: NodeId, depth: number) => {
    if (depth > 8) {
      warnings.push(`warp evaluation exceeded nesting depth at node ${nodeId}`);
      return;
    }
    const node = doc.nodes[nodeId];
    if (!node || node.visible === false) return;
    if (node.kind === 'adjustment') {
      warnings.push('adjustment nodes inside a warped container are not applied');
      return;
    }
    if (node.kind === 'group' || node.kind === 'frame') {
      if ('children' in node) {
        for (const childId of node.children) walk(childId, depth + 1);
      }
      return;
    }
    const engineNode = sceneNodeToEngineNode(
      node,
      { useMaskRenderProxy: true },
      doc,
    ) as unknown as RenderItem;
    const childWorld = engineNode.transform;
    const chainToContainer = localTransformToAncestor(doc, nodeId, containerId);
    const result = evaluateLeaf(
      node,
      engineNode,
      chainToContainer,
      evalWarp,
      tolerance,
      budget,
      warnings,
    );
    if (!result) return;
    const item: RenderItem = { ...engineNode, transform: childWorld, ...result.primitiveFields };
    items.push({ item, worldBounds: result.bounds, warnings });
    union = rectUnion(union, result.bounds);
  };

  for (const childId of container.children) walk(childId, 0);
  return { items, bounds: union, warnings };
}

function containerBoundsInLocal(doc: Document, containerId: NodeId): Rect | null {
  const container = doc.nodes[containerId];
  if (!container) return null;
  let union: Rect | null = null;
  const visit = (nodeId: NodeId) => {
    const node = doc.nodes[nodeId];
    if (!node) return;
    if (node.kind === 'group' || node.kind === 'frame') {
      if ('children' in node) {
        for (const c of node.children) visit(c);
      }
      return;
    }
    const local = nodeLocalBoundsSource(node, doc);
    if (!local) return;
    const m = localTransformToAncestor(doc, nodeId, containerId);
    if (!m) return;
    const corners: Array<[number, number]> = [
      [local.x, local.y],
      [local.x + local.w, local.y],
      [local.x + local.w, local.y + local.h],
      [local.x, local.y + local.h],
    ];
    for (const [x, y] of corners) {
      const p = applyAffine(m, [x, y]);
      union = rectUnion(union, { x: p[0], y: p[1], w: 0, h: 0 });
    }
  };
  if ('children' in container) {
    for (const c of container.children) visit(c);
  }
  return union ?? { x: 0, y: 0, w: 1, h: 1 };
}

function evaluateLeaf(
  node: import('@varve/scene').SceneNode,
  engineNode: RenderItem,
  chainToContainer: readonly number[] | null,
  evalWarp: WarpEvaluation,
  tolerance: number,
  budget: { maxDepth: number; maxPoints: number },
  warnings: string[],
): {
  primitiveFields: {
    primitive: Primitive;
    glyphAdjustments?: Record<number, import('@varve/engine').GlyphAdjustmentIR>;
  };
  bounds: Rect | null;
} | null {
  if (node.kind === 'shape') {
    const ownWarps = warpsOnNode(node);
    const ownBounds = nodeLocalBoundsSource(node);
    let ring: PathPoint[] = [];
    let closed = false;
    let holes: PathPoint[][] | undefined;
    let fillRule: 'nonzero' | 'evenodd' | undefined;
    if (ownWarps.some((w) => w.enabled !== false) && ownBounds) {
      const r = warpShapeToPath(node.shape, ownWarps, ownBounds, {
        quality: { profile: 'interactive', tolerance },
      });
      if (r.shape.kind === 'path') {
        ring = r.shape.points;
        closed = r.shape.closed;
        holes = r.shape.holes;
        fillRule = r.shape.fillRule;
      }
    } else {
      const c = shapeToPathPoints(node.shape);
      ring = c.points;
      closed = c.closed;
      holes = c.holes;
      fillRule = c.fillRule;
    }
    if (chainToContainer) ring = mapRingByAffine(ring, chainToContainer);
    const warped = warpPathRing(ring, closed, evalWarp, tolerance, budget);
    const prim: Primitive = {
      kind: 'path',
      points: warped.points,
      closed,
      tolerance: 0.5,
      ...(holes && holes.length > 0 ? { holes } : {}),
      ...(fillRule ? { fillRule } : {}),
    };
    return {
      primitiveFields: { primitive: prim },
      bounds: warped.points.length > 0 ? ringBounds(warped.points) : null,
    };
  }
  if (node.kind === 'text') {
    const textNode = node as import('@varve/scene').TextNode;
    if (warpsOnNode(node).some((w) => w.enabled !== false)) {
      warnings.push(
        'text with its own warp inside a warped container: only the container warp applies',
      );
    }
    // Composed map: M⁻¹ ∘ warp ∘ M, evaluated in the text's local space.
    if (!chainToContainer) return null;
    const inv = tryInvertAffine([...chainToContainer] as unknown as import('@varve/shared').Affine);
    if (!inv) return null;
    const m = chainToContainer;
    const a = m[0]!;
    const b = m[1]!;
    const c = m[2]!;
    const d = m[3]!;
    const e = m[4]!;
    const f = m[5]!;
    const ia = inv[0]!;
    const ib = inv[1]!;
    const ic = inv[2]!;
    const id = inv[3]!;
    const ie = inv[4]!;
    const if_ = inv[5]!;
    const composed: WarpEvaluation = {
      map: (x, y) => {
        const px = a * x + c * y + e;
        const py = b * x + d * y + f;
        const wp = evalWarp.map(px, py);
        return [ia * wp[0] + ic * wp[1] + ie, ib * wp[0] + id * wp[1] + if_];
      },
      jacobian: (x, y) => {
        const eps = 1e-3;
        const px = composed.map(x + eps, y);
        const mx = composed.map(x - eps, y);
        const py = composed.map(x, y + eps);
        const my = composed.map(x, y - eps);
        return {
          dxdu: (px[0] - mx[0]) / (2 * eps),
          dxdv: (py[0] - my[0]) / (2 * eps),
          dydu: (px[1] - mx[1]) / (2 * eps),
          dydv: (py[1] - my[1]) / (2 * eps),
        };
      },
      maps: [],
      invalid: [],
      sourceBounds: evalWarp.sourceBounds,
    };
    // Warp cluster adjustments are computed inside the node's real box; a
    // per-character estimate here disagreed with the cage drawn around it.
    const textBounds = textNodeLocalBounds(textNode);
    const width = textBounds.w;
    const height = textBounds.h;
    const result = warpTextToClusterAdjustments(
      {
        text: textNode.text,
        fontSize: textNode.fontSize ?? 14,
        fontFamily: textNode.fontFamily ?? 'sans-serif',
        fontWeight: textNode.fontWeight,
        fontStyle: textNode.fontStyle,
        letterSpacing: textNode.letterSpacing,
        tracking: textNode.tracking,
        w: width,
        h: height,
        textAlign: textNode.textAlign,
        direction: textNode.direction,
        measure: createClusterMeasure(textNode.fontSize ?? 14, textNode.fontFamily ?? 'sans-serif'),
      },
      composed,
    );
    if (result.unsupported) {
      warnings.push(`warped text skipped in container: ${result.unsupported}`);
      return null;
    }
    const glyphAdjustments = result.adjustments;
    const textShape = (engineNode as unknown as { shape?: Record<string, unknown> }).shape;
    if (textShape?.kind !== 'text') return null;
    return {
      primitiveFields: {
        primitive: {
          ...textShape,
          ...(Object.keys(glyphAdjustments).length > 0 ? { glyphAdjustments } : {}),
        } as unknown as Primitive,
      },
      bounds: { x: 0, y: 0, w: width, h: height },
    };
  }
  return null;
}

/** World-space AABB of the evaluated items (conservative union). */
export function warpedContainerWorldBounds(items: EvaluatedItem[]): Rect | null {
  let union: Rect | null = null;
  for (const { item, worldBounds } of items) {
    if (!worldBounds) continue;
    const t = item.transform as readonly number[];
    const a = t[0]!;
    const b = t[1]!;
    const c = t[2]!;
    const d = t[3]!;
    const e = t[4]!;
    const f = t[5]!;
    const x = worldBounds.x;
    const y = worldBounds.y;
    const w = worldBounds.w;
    const h = worldBounds.h;
    const corners: Array<[number, number]> = [
      [a * x + c * y + e, b * x + d * y + f],
      [a * (x + w) + c * y + e, b * (x + w) + d * y + f],
      [a * (x + w) + c * (y + h) + e, b * (x + w) + d * (y + h) + f],
      [a * x + c * (y + h) + e, b * x + d * (y + h) + f],
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [cx, cy] of corners) {
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
    }
    union = rectUnion(union, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }
  return union;
}
