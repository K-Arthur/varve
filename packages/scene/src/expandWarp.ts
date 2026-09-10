/**
 * Expand Appearance — the explicit, destructive bake of a live warp stack.
 *
 * Uses the SAME canonical evaluator as rendering and export (never a
 * separate approximation). After baking:
 *  - shape nodes become exact evaluated path nodes (fills/strokes/effects/
 *    transform preserved); the warp stack is cleared.
 *  - text nodes keep their text: the derived per-cluster warp adjustments
 *    are baked into `glyphAdjustments` and the warp stack is cleared.
 *  - warped containers (groups/frames) are NOT baked in this version —
 *    the container warp affects its children jointly, and flattening that
 *    subtree destructively is deferred (use export flattening instead).
 *
 * Undo always restores the exact pre-expand document (snapshot undo).
 */

import {
  buildWarpEvaluation,
  createClusterMeasure,
  hasLiveWarps,
  type WarpQualitySettings,
  warpShapeToPath,
  warpTextToClusterAdjustments,
} from '@varve/engine';
import type { Document } from './document';
import { nodeLocalBoundsSource } from './nodeBounds';
import type { NodeId, SceneNode, TextNode } from './types';
import { warpsOnNode } from './warpOps';

export type ExpandWarpResult =
  | { kind: 'baked'; node: SceneNode }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'noop' };

/** Bake one node's warp stack in place (returns the same doc on no-op). */
export function bakeNodeWarp(
  node: SceneNode,
  doc?: { paints?: Record<string, import('./types').Paint> },
  quality: WarpQualitySettings = { profile: 'export' },
): ExpandWarpResult {
  const warps = warpsOnNode(node);
  if (!hasLiveWarps(warps)) return { kind: 'noop' };

  if (node.kind === 'shape') {
    const sourceBounds = nodeLocalBoundsSource(node, doc);
    if (!sourceBounds) return { kind: 'unsupported', reason: 'shape has no source bounds' };
    const settings = (node as { warpSettings?: import('@varve/engine').WarpSettings }).warpSettings;
    const { shape } = warpShapeToPath(node.shape, warps, sourceBounds, {
      settings,
      quality,
    });
    const { warps: _w, warpSettings: _s, ...rest } = node;
    const baked = { ...rest, shape } as SceneNode;
    return { kind: 'baked', node: baked };
  }

  if (node.kind === 'text') {
    if (node.richText || node.textMode === 'path') {
      return {
        kind: 'unsupported',
        reason: 'rich text and text-on-path are not expandable in this version',
      };
    }
    const sourceBounds = nodeLocalBoundsSource(node, doc);
    if (!sourceBounds) return { kind: 'unsupported', reason: 'text has no source bounds' };
    const settings = (node as { warpSettings?: import('@varve/engine').WarpSettings }).warpSettings;
    const fontSize = node.fontSize ?? 14;
    // Warp evaluates against the node's real box; a per-character estimate
    // here disagreed with the bounds the warp cage is drawn from.
    const width = sourceBounds.w;
    const height = sourceBounds.h;
    const warped = warpTextToClusterAdjustments(
      {
        text: node.text,
        fontSize,
        fontFamily: node.fontFamily ?? 'sans-serif',
        fontWeight: node.fontWeight,
        fontStyle: node.fontStyle,
        letterSpacing: node.letterSpacing,
        tracking: node.tracking,
        w: width,
        h: height,
        textAlign: node.textAlign,
        direction: node.direction,
        measure: createClusterMeasure(fontSize, node.fontFamily ?? 'sans-serif'),
      },
      buildWarpEvaluation(warps, sourceBounds, settings ? { settings } : {}),
    );
    if (warped.unsupported) {
      return { kind: 'unsupported', reason: warped.unsupported };
    }
    const { warps: _w, warpSettings: _s, ...rest } = node;
    const baked = {
      ...rest,
      glyphAdjustments: {
        ...(node.glyphAdjustments ?? {}),
        ...warped.adjustments,
      },
    } as TextNode;
    return { kind: 'baked', node: baked };
  }

  return {
    kind: 'unsupported',
    reason: 'expanding a warped group is not supported in this version',
  };
}

/** Bake warps on every selected node; containers keep their children. */
export function bakeWarpsInDocument(
  doc: Document,
  nodeIds: NodeId[],
  quality: WarpQualitySettings = { profile: 'export' },
): { document: Document; baked: string[]; skipped: string[] } {
  const baked: string[] = [];
  const skipped: string[] = [];
  const nodes = { ...doc.nodes };
  for (const id of nodeIds) {
    const node = nodes[id];
    if (!node) continue;
    const result = bakeNodeWarp(node, doc, quality);
    if (result.kind === 'baked') {
      nodes[id] = result.node;
      baked.push(id);
    } else if (result.kind === 'unsupported') {
      skipped.push(id);
    }
  }
  return { document: { ...doc, nodes }, baked, skipped };
}
