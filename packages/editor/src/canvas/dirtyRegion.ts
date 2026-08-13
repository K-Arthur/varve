/**
 * Conservative document dirty-region analysis.
 *
 * Partial redraw is used only when every changed node is a non-container with
 * known old/new bounds. Structural edits fall back to a full redraw because a
 * parent transform, clip, mask, or isolation change can affect descendants.
 */

import type { Document, NodeId, RasterLayerNode } from '@varve/scene';
import {
  buildParentIndexMap,
  isContainer,
  pageBoundsInWorld,
  parseTileKey,
  resolveAllStyles,
  TILE_SIZE,
} from '@varve/scene';
import type { Rect } from '@varve/shared';
import { PAGE_LABEL_BAND } from './pageDecorations';
import { nodeVisualWorldBounds } from './visualBounds';

export type DirtyRegion =
  | { kind: 'none' }
  | { kind: 'full' }
  | { kind: 'partial'; bounds: Rect; rectCount: number };

/**
 * Why an individual rectangle was contributed, before merging. Recording the
 * source is what makes "the dirty area is large" answerable — a move
 * contributes an old and a new bound, whereas a brush dab contributes tiles.
 */
export type DirtyRectReason =
  | 'node-before'
  | 'node-after'
  | 'node-added'
  | 'node-removed'
  | 'raster-tile'
  | 'page-before'
  | 'page-after';

export interface DirtyRectRecord {
  rect: Rect;
  reason: DirtyRectReason;
  /** Stable diagnostic node id. Never a name or any document content. */
  nodeId: string;
}

/**
 * Bounded recorder for individual pre-merge rectangles.
 *
 * A drag over a large selection can contribute thousands of rectangles per
 * frame, so retention is capped and truncation is reported rather than
 * silently dropping evidence. Passing no recorder keeps the analysis
 * allocation-free, which is the production path.
 */
export class DirtyRegionRecorder {
  static readonly MAX_RECORDED_RECTS = 64;
  private readonly records: DirtyRectRecord[] = [];
  private truncatedCount = 0;

  add(rect: Rect, reason: DirtyRectReason, nodeId: string): void {
    if (this.records.length >= DirtyRegionRecorder.MAX_RECORDED_RECTS) {
      this.truncatedCount++;
      return;
    }
    this.records.push({ rect: { ...rect }, reason, nodeId });
  }

  get rects(): readonly DirtyRectRecord[] {
    return this.records;
  }

  /** Rectangles observed but not retained, so a truncated overlay says so. */
  get truncated(): number {
    return this.truncatedCount;
  }

  reset(): void {
    this.records.length = 0;
    this.truncatedCount = 0;
  }
}

function unionBounds(left: Rect | null, right: Rect): Rect {
  if (!left) return { ...right };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.w, right.x + right.w);
  const maxY = Math.max(left.y + left.h, right.y + right.h);
  return { x, y, w: maxX - x, h: maxY - y };
}

function rasterTileWorldBounds(tileKey: string): Rect {
  const { col, row } = parseTileKey(tileKey);
  return {
    x: col * TILE_SIZE,
    y: row * TILE_SIZE,
    w: TILE_SIZE,
    h: TILE_SIZE,
  };
}

/**
 * Page trim bounds expanded by the decoration band: the drop shadow and the
 * label band below the page are decoration pixels that move with the page,
 * so placement-driven dirty regions must cover them.
 */
function expandPageDecorationBounds(bounds: Rect): Rect {
  return {
    x: bounds.x - PAGE_LABEL_BAND,
    y: bounds.y - PAGE_LABEL_BAND,
    w: bounds.w + PAGE_LABEL_BAND * 2,
    h: bounds.h + PAGE_LABEL_BAND * 2,
  };
}

export interface ChangedPageBounds {
  pageId: NodeId;
  before: Rect | null;
  after: Rect | null;
}

/**
 * Pages present in both documents whose placed trim bounds differ. Empty
 * when the pages arrays are identical, when no shared page moved or
 * resized, or when a page only appears on one side (its content-root group
 * identity change drives the node diff instead).
 */
export function changedPageBounds(previous: Document, next: Document): ChangedPageBounds[] {
  if (previous.pages === next.pages) return [];
  const nextPagesById = new Map<NodeId, NonNullable<Document['pages']>[number]>(
    (next.pages ?? []).map((p) => [p.id, p]),
  );
  const result: ChangedPageBounds[] = [];
  for (const prevPage of previous.pages ?? []) {
    const nextPage = nextPagesById.get(prevPage.id);
    if (!nextPage) continue;
    const before = pageBoundsInWorld(previous, prevPage.id);
    const after = pageBoundsInWorld(next, nextPage.id);
    if (!before && !after) continue;
    if (
      before &&
      after &&
      before.x === after.x &&
      before.y === after.y &&
      before.w === after.w &&
      before.h === after.h
    ) {
      continue;
    }
    result.push({ pageId: prevPage.id, before, after });
  }
  return result;
}

/**
 * Whether any page's placed bounds changed between the two documents —
 * the signal that every cached world transform on those pages is stale
 * (placement/size move page-owned subtrees without node identity changes).
 */
export function pagePlacementChanged(previous: Document, next: Document): boolean {
  return changedPageBounds(previous, next).length > 0;
}

function changedRasterTileBounds(before: RasterLayerNode, after: RasterLayerNode): Rect[] {
  const rects: Rect[] = [];
  const allKeys = new Set<string>([...before.tiles.keys(), ...after.tiles.keys()]);
  for (const key of allKeys) {
    const bTile = before.tiles.get(key);
    const aTile = after.tiles.get(key);
    if (bTile === aTile) continue;
    if (bTile && aTile && bTile.version === aTile.version) continue;
    rects.push(rasterTileWorldBounds(key));
  }
  return rects;
}

/**
 * The effective alpha-mask identity of a node: the authoritative mask asset
 * data URL, or the legacy inline mask data URL. Used to detect mask changes
 * that a bounds diff cannot see (a mask appearing, being edited, or being
 * removed leaves the node's geometry unchanged).
 */
function nodeAlphaMaskIdentity(
  node:
    | { mask?: { rasterMask?: { assetId?: string } }; backgroundRemoval?: { maskDataUrl?: string } }
    | undefined,
): string {
  if (!node) return '';
  const assetId = node.mask?.rasterMask?.assetId;
  if (assetId) return `asset:${assetId}`;
  return node.backgroundRemoval?.maskDataUrl ?? '';
}

export function computeDocumentDirtyRegion(
  previous: Document,
  next: Document,
  forceFull?: boolean,
  nextParentIndex?: Map<NodeId, NodeId>,
  /** Optional bounded collector for individual pre-merge rectangles. */
  recorder?: DirtyRegionRecorder,
): DirtyRegion {
  if (previous === next || forceFull) return { kind: forceFull ? 'full' : 'none' };
  const ids = new Set<NodeId>([...Object.keys(previous.nodes), ...Object.keys(next.nodes)]);
  let bounds: Rect | null = null;
  let rectCount = 0;
  let changed = false;
  // getParent() is O(n) per call, so nodeWorldTransform/nodeWorldBounds walk
  // the ancestor chain in O(n) each. A per-document parent index drops that
  // to O(1); the index itself is O(n) to build, so build lazily only when a
  // bound is actually needed — single-node edits never pay for it.
  const previousStyles = resolveAllStyles(previous);
  const nextStyles = resolveAllStyles(next);
  let previousParents: Map<NodeId, NodeId> | undefined;
  let nextParents: Map<NodeId, NodeId> | undefined;

  // Top-level z-order change (reorder): no node identity changed, but the
  // paint order did — every pixel where the moved node overlaps a neighbor
  // whose relative order changed is visually different. Those pixels are all
  // inside the moved nodes' bounds, so the moved nodes' old+new render bounds
  // are a complete dirty set (the vacated and newly covered regions both
  // repaint). Nested reorders change a container's children array, which the
  // loop below already treats as structural.
  if (previous.rootChildren !== next.rootChildren) {
    const movedIds = new Set<NodeId>();
    const maxLen = Math.max(previous.rootChildren.length, next.rootChildren.length);
    for (let i = 0; i < maxLen; i++) {
      if (previous.rootChildren[i] !== next.rootChildren[i]) {
        if (previous.rootChildren[i]) movedIds.add(previous.rootChildren[i]!);
        if (next.rootChildren[i]) movedIds.add(next.rootChildren[i]!);
      }
    }
    if (movedIds.size > 0) {
      const parents = buildParentIndexMap(next);
      for (const id of movedIds) {
        const node = next.nodes[id];
        if (!node || node.visible === false) continue;
        const beforeNode = previous.nodes[id];
        // Identity-changed nodes are handled by the main loop below.
        if (beforeNode === undefined || beforeNode !== node) continue;
        const afterBounds = nodeVisualWorldBounds(next, id, nextStyles, parents);
        if (!afterBounds) continue;
        changed = true;
        recorder?.add(afterBounds, 'node-after', id);
        bounds = unionBounds(bounds, afterBounds);
        rectCount++;
        const beforeBounds = nodeVisualWorldBounds(
          previous,
          id,
          previousStyles,
          buildParentIndexMap(previous),
        );
        if (beforeBounds) {
          recorder?.add(beforeBounds, 'node-before', id);
          bounds = unionBounds(bounds, beforeBounds);
          rectCount++;
        }
      }
    }
  }

  // Page placement/size changes (ADR-0124): the page moves every node on it
  // without changing any node identity — content roots keep their local
  // geometry — so the per-node diff below would report 'none' and leave
  // stale pixels everywhere. Compare the placed trim bounds of every page id
  // present in both documents and contribute old+new bounds (expanded by the
  // label band, which also covers the drop shadow) when they differ. Page
  // add/remove/reorder still surface through node identity changes (new or
  // removed content-root groups are containers -> full redraw), and page
  // number/name/active-page changes surface as doc changes with a 'none'
  // dirty region, which the paint path treats as a full redraw.
  if (previous.pages !== next.pages) {
    for (const { before, after, pageId } of changedPageBounds(previous, next)) {
      changed = true;
      if (before) {
        const expanded = expandPageDecorationBounds(before);
        recorder?.add(expanded, 'page-before', pageId);
        bounds = unionBounds(bounds, expanded);
        rectCount++;
      }
      if (after) {
        const expanded = expandPageDecorationBounds(after);
        recorder?.add(expanded, 'page-after', pageId);
        bounds = unionBounds(bounds, expanded);
        rectCount++;
      }
    }
  }

  for (const id of ids) {
    const before = previous.nodes[id];
    const after = next.nodes[id];
    if (before === after) continue;
    changed = true;

    if ((before && isContainer(before)) || (after && isContainer(after))) {
      return { kind: 'full' };
    }

    // A raster-mask identity change (background removal applied, edited, or
    // reset) keeps the node's geometry identical but can turn opaque pixels
    // transparent — revealing content painted BELOW the node that a partial
    // repaint would never replay. The partial path's dependency expansion
    // covers ancestors, mask sources, and flatten subtrees, not lower
    // overlapping siblings, so a cleared region around a masked node is not
    // reconstructable from its replay set. Fall back to a full redraw for any
    // mask identity change (the mission's "revealed content" invariant):
    // correctness first; a targeted lower-sibling expansion can be recovered
    // later with regression coverage. A node that merely moves keeps its mask
    // identity, and its old+new bounds already pull the revealed lower
    // content into the dirty set, so plain moves stay partial.
    if (nodeAlphaMaskIdentity(before) !== nodeAlphaMaskIdentity(after)) {
      return { kind: 'full' };
    }

    if (before?.kind === 'rasterLayer' || after?.kind === 'rasterLayer') {
      const rBefore = before as RasterLayerNode | undefined;
      const rAfter = after as RasterLayerNode | undefined;

      if (rBefore && rAfter) {
        const tileRects = changedRasterTileBounds(rBefore, rAfter);
        if (tileRects.length === 0) continue;
        for (const tr of tileRects) {
          recorder?.add(tr, 'raster-tile', id);
          bounds = unionBounds(bounds, tr);
          rectCount++;
        }
        continue;
      }
    }

    if (before && after) {
      previousParents ??= buildParentIndexMap(previous);
      nextParents ??= nextParentIndex ?? buildParentIndexMap(next);
      const beforeBounds = nodeVisualWorldBounds(previous, id, previousStyles, previousParents);
      const afterBounds = nodeVisualWorldBounds(next, id, nextStyles, nextParents);
      if (!beforeBounds && !afterBounds) {
        return { kind: 'full' };
      }
      if (beforeBounds) {
        recorder?.add(beforeBounds, 'node-before', id);
        bounds = unionBounds(bounds, beforeBounds);
        rectCount++;
      }
      if (afterBounds) {
        recorder?.add(afterBounds, 'node-after', id);
        bounds = unionBounds(bounds, afterBounds);
        rectCount++;
      }
    } else {
      // Added or removed node: only one side has a bound to compute.
      const doc = after ? next : previous;
      const styles = after ? nextStyles : previousStyles;
      nextParents ??= after ? (nextParentIndex ?? buildParentIndexMap(next)) : undefined;
      previousParents ??= after ? undefined : buildParentIndexMap(previous);
      const changedBounds = nodeVisualWorldBounds(
        doc,
        id,
        styles,
        after ? nextParents : previousParents,
      );
      if (!changedBounds) return { kind: 'full' };
      recorder?.add(changedBounds, after ? 'node-added' : 'node-removed', id);
      bounds = unionBounds(bounds, changedBounds);
      rectCount++;
    }
  }

  if (!changed) return { kind: 'none' };
  return bounds ? { kind: 'partial', bounds, rectCount } : { kind: 'full' };
}

/**
 * Stable redraw-reason codes so every presented frame can be attributed. An
 * unattributed frame is an 'unknown' and should be treated as technical debt.
 */
export type RedrawReason =
  | 'clean'
  | 'geometry-change'
  | 'structural-change'
  | 'camera-change'
  | 'image-decode'
  | 'font-load'
  | 'variable-change'
  | 'unknown';

export interface RedrawAttributionInput {
  /** Document identity changed since the last rendered document. */
  docChanged: boolean;
  dirtyKind: DirtyRegion['kind'];
  /** Camera (zoom/pan/rotation) changed since the last rendered frame. */
  cameraChanged: boolean;
  imageCacheStampChanged: boolean;
  fontLoadStampChanged: boolean;
  variableOnlyChange: boolean;
}

/**
 * Attribute why a frame is being redrawn. Document changes win (a dirty
 * document is the frame's primary cause); a clean document with a moving
 * camera is a camera change; otherwise decode/font-load stamps. A redraw with
 * none of these signals is 'clean' — e.g. a worker-result present or overlay
 * refresh — which is itself useful: it proves no document/camera invalidation
 * was needed to present the frame.
 */
export function resolveRedrawReason(input: RedrawAttributionInput): RedrawReason {
  if (input.docChanged) {
    if (input.variableOnlyChange) return 'variable-change';
    if (input.dirtyKind === 'partial') return 'geometry-change';
    if (input.dirtyKind === 'full') return 'structural-change';
  }
  if (input.cameraChanged) return 'camera-change';
  if (input.imageCacheStampChanged) return 'image-decode';
  if (input.fontLoadStampChanged) return 'font-load';
  return 'clean';
}

export type FullRedrawReason =
  | 'structural'
  | 'camera-rotation'
  | 'camera-moved'
  | 'surface-stale'
  | 'profile-disabled'
  | 'dirty-area-limit'
  | 'no-dirty-rect';

/**
 * Attribute why a dirty frame fell back to a full redraw instead of a partial
 * one. `null` means the frame was able to (or did not need to) do a partial
 * redraw.
 */
export function resolveFullRedrawReason(opts: {
  rotation: number;
  profileEnablePartialRedraw: boolean;
  dirtyRectArea: number;
  viewportArea: number;
  hasDirtyRect: boolean;
  /** Result of `surfaceMatchesBackingStore` for this frame (defaults to true). */
  surfaceMatch?: SurfaceMatch;
}): FullRedrawReason | null {
  if (!opts.hasDirtyRect) return 'no-dirty-rect';
  if (opts.rotation !== 0) return 'camera-rotation';
  const surfaceMatch = opts.surfaceMatch ?? 'match';
  if (surfaceMatch === 'camera-moved') return 'camera-moved';
  if (surfaceMatch !== 'match') return 'surface-stale';
  if (!opts.profileEnablePartialRedraw) return 'profile-disabled';
  if (opts.dirtyRectArea > opts.viewportArea * 0.6) return 'dirty-area-limit';
  return null;
}

/**
 * Identity of the camera and surface the backing store was last painted under.
 * Partial redraw retains every pixel outside the dirty rects, so those pixels
 * are only valid while the camera and surface are byte-for-byte the same as
 * when they were painted.
 */
export interface PaintedSurfaceIdentity {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  dpr: number;
  /** Device-pixel backing-store dimensions (canvas.width / canvas.height). */
  surfaceW: number;
  surfaceH: number;
}

export type SurfaceMatch = 'match' | 'never-painted' | 'camera-moved' | 'surface-resized';

/**
 * Whether the retained backing-store pixels are still valid for this frame.
 *
 * A pan, zoom or rotation moves every retained pixel to the wrong place: the
 * dirty rects would repaint under the new camera while everything around them
 * still shows the previous scroll offset (stale pixels, and a visible seam at
 * the clip boundary). A surface resize or DPR change reallocates the backing
 * store entirely. In both cases the frame must be a full redraw.
 *
 * Exact equality is deliberate — a sub-pixel pan still shifts content, and a
 * tolerance here trades a correctness guarantee for at most one repaint.
 */
/**
 * What to record as the painted surface after a frame completes.
 *
 * A frame may paint an *approximation* of the current camera rather than an
 * authoritative render of it — today that is the reprojected worker bitmap
 * path, which composites a resampled older frame while the worker produces a
 * fresh one. Those pixels are not reusable: regions the camera just exposed
 * contain stretched edge content, and a later partial redraw would composite
 * fresh dirty rects over them.
 *
 * Recording `null` for such a frame costs exactly one full redraw and keeps
 * the invariant that retained pixels always equal what a full redraw of the
 * same state would have produced.
 */
export function paintedSurfaceAfterFrame(
  surface: PaintedSurfaceIdentity,
  authoritative: boolean,
): PaintedSurfaceIdentity | null {
  return authoritative ? surface : null;
}

export function surfaceMatchesBackingStore(
  painted: PaintedSurfaceIdentity | null,
  current: PaintedSurfaceIdentity,
): SurfaceMatch {
  if (painted === null) return 'never-painted';
  if (
    painted.surfaceW !== current.surfaceW ||
    painted.surfaceH !== current.surfaceH ||
    painted.dpr !== current.dpr
  ) {
    return 'surface-resized';
  }
  if (
    painted.zoom !== current.zoom ||
    painted.panX !== current.panX ||
    painted.panY !== current.panY ||
    painted.rotation !== current.rotation
  ) {
    return 'camera-moved';
  }
  return 'match';
}
