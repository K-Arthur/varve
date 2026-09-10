/**
 * Dirty-region-driven visible-list construction.
 *
 * The candidate query replaces the unconditional per-node acceptance loop:
 * a node is replayed only when its conservative world render bounds intersect
 * at least one merged dirty rectangle. The paint path then clips per-rect
 * (multi-path clip), so the empty gaps between distant invalidations are
 * neither cleared nor repainted.
 *
 * Correctness contract — what the replay set must contain beyond the
 * candidates themselves:
 *
 *   - ancestors of every candidate: a clipped frame, masked frame, isolated
 *     group or blend group must replay to re-establish its clip/mask/
 *     compositing context;
 *   - mask sources of included frames: a frame that replays through its mask
 *     must replay the mask source or the mask renders empty;
 *   - full subtrees of included flatten groups (isolation, opacity, blend,
 *     visible effects, masks): the flatten path re-renders every child into
 *     the group surface, so every descendant's IR must exist.
 *
 * Nodes outside the dirty region need no replay: the per-rect clip removes
 * their pixels, and clipped/retained pixels are exactly what the backing
 * store already shows. The one asymmetry — content revealed by a move is
 * covered because the dirty region includes both old and new bounds.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { isContainer } from '@varve/scene';
import type { Rect } from '@varve/shared';
import type { DirtyRegion, SurfaceMatch } from './dirtyRegion';
import type { DirtyMergeResult } from './dirtyRegionMerge';

/**
 * Decide whether the visible list may be pruned to the merged dirty rects,
 * and map those rects to screen space for the paint path.
 *
 * Pruning is only safe when the paint path will actually use a partial
 * redraw (same gate as `usePartialRedraw`: profile, rotation, positive
 * viewport-clamped union rect under the area threshold, and a backing store
 * whose retained pixels were painted under this exact camera and surface),
 * when the merged set did not fall back to a viewport-sized rect, and when the
 * render worker is not going to draw the whole frame anyway (the worker bitmap
 * must contain every pixel, not just the dirty region).
 *
 * The two gates must never disagree: pruning without a partial paint clears
 * the whole surface and replays only the pruned subset, which erases every
 * node outside the dirty region. `surfaceMatch` is therefore threaded through
 * both from one shared computation per frame.
 */
export function computeDirtyPruneDecision(opts: {
  dirtyKind: DirtyRegion['kind'];
  merged: DirtyMergeResult | null;
  profileEnablePartialRedraw: boolean;
  rotation: number;
  dirtyScreenRect: { x: number; y: number; w: number; h: number } | null;
  viewportW: number;
  viewportH: number;
  workerWillRender: boolean;
  /** Whether retained backing-store pixels are valid; defaults to 'match'. */
  surfaceMatch?: SurfaceMatch;
  worldToScreen: (wx: number, wy: number) => readonly [number, number];
}): { screenRects: readonly Rect[] | null; worldRects: readonly Rect[] | null } {
  const {
    dirtyKind,
    merged,
    profileEnablePartialRedraw,
    rotation,
    dirtyScreenRect,
    viewportW,
    viewportH,
    workerWillRender,
    surfaceMatch = 'match',
    worldToScreen,
  } = opts;
  const pruneable =
    dirtyKind === 'partial' &&
    merged !== null &&
    merged.fallback === 'none' &&
    merged.rects.length > 0 &&
    profileEnablePartialRedraw &&
    rotation === 0 &&
    surfaceMatch === 'match' &&
    dirtyScreenRect !== null &&
    dirtyScreenRect.w > 0 &&
    dirtyScreenRect.h > 0 &&
    dirtyScreenRect.w * dirtyScreenRect.h < viewportW * viewportH * 0.6 &&
    !workerWillRender;
  if (!pruneable) return { screenRects: null, worldRects: null };
  const screenRects = worldRectsToScreen(merged!.rects, worldToScreen, viewportW, viewportH);
  return {
    screenRects: screenRects.length > 0 ? screenRects : null,
    // The paint path clears and clips `screenRects`, which carry a 40px
    // anti-aliasing margin. Selecting replay candidates against the UNexpanded
    // world rects would leave a margin-wide band that is cleared but never
    // replayed: any node inside it is erased outright, and a node straddling
    // the boundary keeps only the sliver lying outside the cleared area.
    //
    // Expanding the world rects by the same margin makes the two gates cover
    // the same region. Over-inclusion is safe here — it replays a few extra
    // nodes — whereas under-inclusion destroys pixels.
    worldRects:
      screenRects.length > 0 ? expandWorldRectsByScreenMargin(merged!.rects, worldToScreen) : null,
  };
}

/**
 * Grow world rects by the world-space equivalent of the paint path's screen
 * margin. The scale is derived from `worldToScreen` itself rather than passed
 * in, so the two can never disagree about the camera.
 */
function expandWorldRectsByScreenMargin(
  rects: readonly Rect[],
  worldToScreen: (wx: number, wy: number) => readonly [number, number],
  margin = DIRTY_SCREEN_MARGIN,
): Rect[] {
  const [originX, originY] = worldToScreen(0, 0);
  const [unitX, unitY] = worldToScreen(1, 1);
  const scaleX = Math.abs(unitX - originX);
  const scaleY = Math.abs(unitY - originY);
  // A degenerate or unreadable scale must not silently shrink the region.
  const marginX = scaleX > 1e-6 ? margin / scaleX : margin;
  const marginY = scaleY > 1e-6 ? margin / scaleY : margin;
  return rects.map((r) => ({
    x: r.x - marginX,
    y: r.y - marginY,
    w: r.w + marginX * 2,
    h: r.h + marginY * 2,
  }));
}

/**
 * Anti-aliasing margin, in screen pixels, applied to every dirty rect.
 *
 * Shared by the paint path (which clears and clips this region) and the
 * candidate query (which must replay every node inside it). One constant so
 * the two cannot drift apart — a cleared-but-not-replayed band erases pixels.
 */
export const DIRTY_SCREEN_MARGIN = 40;

/** Half-open rectangle overlap; edge-touching rects do not intersect. */
export function rectsIntersectAny(
  a: { x: number; y: number; w: number; h: number },
  rects: readonly { x: number; y: number; w: number; h: number }[],
): boolean {
  for (const b of rects) {
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a container's replay must include its entire subtree regardless of
 * the candidate set. Mirrors the flatten/mask conditions in the replay path
 * (CanvasArea.replaySubtreeToCtx): isolation, non-normal blend, opacity < 1,
 * any visible effect, or a mask force a full-subtree render.
 */
export function groupNeedsFullSubtree(node: SceneNode): boolean {
  if (!isContainer(node)) return false;
  if (node.kind === 'group') {
    if (node.isolated === true) return true;
    const blend = node.blendMode ?? 'passThrough';
    if (blend !== 'normal' && blend !== 'passThrough') return true;
    if ((node.opacity ?? 1) < 1) return true;
    if ((node.effects ?? []).some((effect) => effect.visible !== false)) return true;
  }
  const mask = 'mask' in node && node.mask ? node.mask : null;
  return Boolean(mask && mask.visible !== false);
}

export interface ReplayExpansion {
  /** Every node that may paint inside the dirty region (accepted + deps). */
  replaySet: Set<NodeId>;
  /**
   * Non-container dependency ids to append to the IR list (paint order is
   * irrelevant for the main-thread replay, which looks IR up by node id; the
   * worker always receives the full list and is never pruned).
   */
  appendIds: NodeId[];
  ancestorsIncluded: number;
  compositingDependencies: number;
}

/**
 * Expand the accepted candidate list into the full replay set: ancestors,
 * their mask sources, and the full subtrees of included flatten groups.
 * Deterministic, bounded by the scene size once per dirty frame.
 */
export function expandReplayDependencies(opts: {
  doc: Document;
  accepted: readonly NodeId[];
  parentIndex?: Map<NodeId, NodeId>;
}): ReplayExpansion {
  const { doc, accepted, parentIndex } = opts;
  const replaySet = new Set<NodeId>(accepted);
  const appendIds: NodeId[] = [];
  let ancestorsIncluded = 0;
  let compositingDependencies = 0;

  // Ancestors first (their own mask sources and flatten subtrees are handled
  // below in the same pass over a stable snapshot).
  const pending = [...accepted];
  for (const id of pending) {
    let parent = parentIndex?.get(id);
    while (parent) {
      if (!replaySet.has(parent)) {
        replaySet.add(parent);
        ancestorsIncluded++;
        const ancestor = doc.nodes[parent];
        if (ancestor && ancestor.kind !== 'group') appendIds.push(parent);
        pending.push(parent);
      }
      parent = parentIndex?.get(parent);
    }
  }

  const pushSubtree = (rootId: NodeId): void => {
    const stack: NodeId[] = [];
    const root = doc.nodes[rootId];
    if (root && 'children' in root && root.children) stack.push(...root.children);
    while (stack.length > 0) {
      const childId = stack.pop()!;
      const child = doc.nodes[childId];
      if (child && replaySet.has(childId)) continue;
      replaySet.add(childId);
      compositingDependencies++;
      if (child && child.kind !== 'group') appendIds.push(childId);
      if (child && 'children' in child && child.children) {
        stack.push(...child.children);
      }
    }
  };

  for (const id of [...replaySet]) {
    const node = doc.nodes[id];
    if (!node) continue;
    // Masks force a full-subtree render (the mask source and every child
    // composite through it), so this also covers mask sources.
    if (groupNeedsFullSubtree(node)) {
      pushSubtree(id);
    }
  }

  return { replaySet, appendIds, ancestorsIncluded, compositingDependencies };
}

/**
 * Map merged world-space dirty rects to viewport-clamped screen rects with an
 * anti-aliasing margin, rounded outward so retained and redrawn backing-store
 * regions cannot leave one-pixel seams.
 */
export function worldRectsToScreen(
  rects: readonly Rect[],
  worldToScreen: (wx: number, wy: number) => readonly [number, number],
  viewportW: number,
  viewportH: number,
  margin = DIRTY_SCREEN_MARGIN,
): Rect[] {
  const out: Rect[] = [];
  for (const rect of rects) {
    let minSx = Number.POSITIVE_INFINITY;
    let minSy = Number.POSITIVE_INFINITY;
    let maxSx = Number.NEGATIVE_INFINITY;
    let maxSy = Number.NEGATIVE_INFINITY;
    const corners: Array<readonly [number, number]> = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ];
    for (const [wx, wy] of corners) {
      const [px, py] = worldToScreen(wx, wy);
      minSx = Math.min(minSx, px);
      minSy = Math.min(minSy, py);
      maxSx = Math.max(maxSx, px);
      maxSy = Math.max(maxSy, py);
    }
    // Round outward (floor min, ceil max) so fractional transforms cannot
    // leave a strip of stale pixels between the cleared and retained regions.
    const x = Math.max(0, Math.floor(minSx - margin));
    const y = Math.max(0, Math.floor(minSy - margin));
    const w = Math.min(viewportW, Math.ceil(maxSx + margin)) - x;
    const h = Math.min(viewportH, Math.ceil(maxSy + margin)) - y;
    if (w > 0 && h > 0) out.push({ x, y, w, h });
  }
  return out;
}
