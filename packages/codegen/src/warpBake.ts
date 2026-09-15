/**
 * Export-time warp baking.
 *
 * SVG, PDF and code targets have no editable envelope-distort primitive, so a
 * live warp stack must be resolved to ordinary vector geometry on the way out
 * (ADR-0166). This module is the single place that resolution happens, so the
 * per-node emitter (`svg.ts`) and the document emitter (`index.ts`) cannot
 * drift into different operation orders — the requirement that every backend
 * resolve the same effective geometry.
 *
 * The evaluator is the canonical one from `@varve/engine` (the same code the
 * canvas, hit testing and Expand Appearance use), invoked at the `export`
 * quality profile rather than the interactive tolerance.
 */

import type { Shape, WarpQualitySettings, WarpSettings } from '@varve/engine';
import { hasLiveWarps, warpShapeToPath } from '@varve/engine';
import type { Paint, SceneNode } from '@varve/scene';
import { nodeLocalBoundsSource, warpsOnNode } from '@varve/scene';

/** Paint lookup needed to resolve shapeless nodes' source bounds. */
type PaintDoc = { paints?: Record<string, Paint> } | undefined;

/**
 * Export-quality evaluation: the `export` profile resolves to a 0.1px
 * source-space tolerance, tighter than the interactive profile so exported
 * curves are not visibly faceted. Depth and point budgets fall back to the
 * engine defaults; a capped result is reported via `bakeWarpedShape`.
 *
 * Deliberately just the profile — Expand Appearance (`scene/expandWarp.ts`)
 * also passes `{ profile: 'export' }`, so both destructive-bake paths resolve
 * through the same table and cannot drift apart on a duplicated constant.
 */
export const EXPORT_WARP_QUALITY: WarpQualitySettings = { profile: 'export' };

/** True when the node carries at least one enabled warp modifier. */
export function nodeHasLiveWarp(node: SceneNode): boolean {
  return hasLiveWarps(warpsOnNode(node));
}

/**
 * True when a code target (CSS / Flutter / SwiftUI / React) cannot represent
 * the node natively because of its warp stack, and must fall back to raster.
 *
 * Every live warp qualifies, including `skew`. A skew modifier is affine and
 * *could* in principle fold into an emitted transform, but the code emitters
 * read `node.transform` — which the modifier stack deliberately does not
 * touch — so emitting natively today would silently drop the deformation.
 * Folding affine-only stacks into the emitted transform is the refinement
 * that would let skew stay native; until then, flattening is the honest
 * answer (§26: never silently omit the warp).
 */
export function warpRequiresFlattening(node: SceneNode): boolean {
  return nodeHasLiveWarp(node);
}

export interface BakedWarp {
  /** Warp-evaluated geometry, always a `path` shape. */
  shape: Shape;
  /** True when a subdivision budget was hit and fidelity was bounded. */
  capped: boolean;
}

/**
 * Evaluate a shape node's live warp stack into exact export-quality path
 * geometry. Returns `null` when the node is not a warped shape, in which case
 * callers emit the source shape unchanged — a disabled or absent modifier must
 * round-trip the original representation exactly, never an approximation.
 */
export function bakeWarpedShape(node: SceneNode, doc?: PaintDoc): BakedWarp | null {
  if (node.kind !== 'shape') return null;
  const warps = warpsOnNode(node);
  if (!hasLiveWarps(warps)) return null;
  const sourceBounds = nodeLocalBoundsSource(node, doc);
  // Zero/degenerate source bounds evaluate to identity upstream; skipping here
  // keeps the source shape rather than emitting a pointless path conversion.
  if (!sourceBounds || sourceBounds.w === 0 || sourceBounds.h === 0) return null;
  const settings = (node as { warpSettings?: WarpSettings }).warpSettings;
  const { shape, capped } = warpShapeToPath(node.shape, warps, sourceBounds, {
    ...(settings ? { settings } : {}),
    quality: EXPORT_WARP_QUALITY,
  });
  return { shape, capped };
}

// Baking is invoked once for bounds and once for emission. Scene nodes are
// immutable, so a node reference identifies its geometry — the same keying
// rule the editor's engine-node memo uses. A WeakMap keeps this cache from
// retaining nodes after a document closes.
const bakeCache = new WeakMap<object, BakedWarp | null>();

/** `bakeWarpedShape` memoized on the immutable node reference. */
export function bakedWarpedShapeCached(node: SceneNode, doc?: PaintDoc): BakedWarp | null {
  const cached = bakeCache.get(node);
  if (cached !== undefined) return cached;
  const result = bakeWarpedShape(node, doc);
  bakeCache.set(node, result);
  return result;
}

/**
 * The geometry a node should export as: baked warp result when the stack is
 * live, otherwise the canonical source shape.
 */
export function exportShapeOf(node: Extract<SceneNode, { kind: 'shape' }>, doc?: PaintDoc): Shape {
  return bakedWarpedShapeCached(node, doc)?.shape ?? node.shape;
}

/**
 * A live warp this exporter cannot bake into SVG vector geometry.
 *
 * Warps are allowed on shape, text, group and frame nodes, but only shape
 * leaves have source geometry this module can evaluate:
 *
 * - **text** would need glyph outlines from the shaping backend (the canvas
 *   warps text via per-cluster adjustments, which SVG `<text>` cannot carry).
 * - **group / frame** would need every descendant leaf evaluated into the
 *   container's warp domain.
 *
 * Those cases export their undeformed source today. That is a real gap, so it
 * is reported through `svgTargetGaps` and annotated in the output rather than
 * dropped silently (§26: never silently omit the warp).
 */
export function unbakeableWarpKind(node: SceneNode): 'text' | 'container' | null {
  if (!nodeHasLiveWarp(node)) return null;
  if (node.kind === 'text') return 'text';
  if (node.kind === 'group' || node.kind === 'frame') return 'container';
  return null;
}
