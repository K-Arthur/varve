/**
 * SelectTool — selection, move, marquee.
 *
 * Gesture states: idle → (click empty → deselect) | (click node → select)
 *                 | (drag node → move) | (drag empty → marquee)
 * Depth cycling: clicking an already-selected single node cycles to the next
 *   overlapping node below (B1). Transparent/stroke-only shapes pass through
 *   to the next filled node below (B2).
 * Arrow keys nudge along local affine axes for rotated nodes (A2).
 * Tab cycles selection through visible unlocked nodes (B4).
 * Alt+marquee selects only fully contained nodes (A3).
 *
 * Research basis: Figma Move tool (V), Illustrator selection, Affinity Designer.
 */

import { applyAffine, invertAffine, rectContains } from '@varve/engine';
import {
  activePageNodes,
  buildParentIndexMap,
  getParent,
  isInIsolatedSubtree,
  type NodeId,
  walkNodes,
  worldToPageAtPoint,
} from '@varve/scene';
import {
  cubicBezierClosestPoint,
  managedColorToRgba,
  pathPointToBezier,
  pointToSegmentDistSq,
} from '@varve/shared';
import { executeNudge, type NudgeDirection } from '../commands/nudge';
import { nodeWorldBounds, nodeWorldTransform, worldToParent } from '../scene/world';
import { loadSettings } from '../settings';
import { BaseTool } from './BaseTool';
import { interactionSession } from './InteractionContext';
import {
  isMarqueeSelectableNode,
  marqueeGeometryHit,
  normalizeMarqueeRect,
} from './marqueeGeometry';
import {
  commitNodeSelectionOperation,
  marqueeUsesContainment,
  type SelectionOperation,
  selectionOperationFromModifiers,
} from './selectionOperations';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

/** Long-press duration threshold for touch/stylus deep-selection menu (ms). */
const LONG_PRESS_MS = 500;

/** Movement tolerance (px) for long-press to not be cancelled as a drag. */
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/**
 * World-space centre of a node for reparent decisions (drag-drop and nudge).
 *
 * Bounds are the preferred source; when they are unavailable (empty groups
 * have no own geometry) the node's world-origin translation is used — never
 * the raw local `transform[4/5]`, which is in parent space and would resolve
 * the wrong target frame/page for nodes inside transformed containers.
 */
function worldCenterOf(
  doc: import('@varve/scene').Document,
  selId: NodeId,
  bounds?: { x: number; y: number; w: number; h: number } | null,
): { x: number; y: number } {
  if (bounds) return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const t = nodeWorldTransform(doc, selId);
  return { x: t[4], y: t[5] };
}

export class SelectTool extends BaseTool {
  id = 'select' as const;

  override cursor(state: ToolCursorState): CursorSpec {
    switch (state) {
      case 'drag':
        return { css: 'move' };
      case 'hover':
        return { css: 'move' };
      default:
        return { css: 'default' };
    }
  }

  private marqueeActive = false;
  private marqueeOperation: SelectionOperation = 'replace';
  private marqueeContainment = false;
  private isMoveGesture = false;
  private initialPositions = new Map<string, { x: number; y: number }>();
  private hasDuplicated = false;
  private nudgeGestureActive = false;
  /** Nodes that were selected when an Alt-duplicate fired, in selection order. */
  private duplicateSourceIds: string[] = [];
  /** True between firing an Alt-duplicate and the clones becoming the selection. */
  private awaitingDuplicateHandoff = false;
  /** Long-press timer for touch/stylus deep selection. */
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  /** Long-press start position for move-tolerance check. */
  private longPressStart: { x: number; y: number } | null = null;
  /** Whether this pointer down already fired a long-press action. */
  private longPressFired = false;

  private visibilityHandler: (() => void) | null = null;

  override onActivate(ctx: ToolContext): void {
    // Returning to the object-selection domain removes any raster boundary so
    // node handles and pixel ants cannot be mistaken for one selection. Apply
    // from Selection Paint is the exception: the user has explicitly finished
    // editing and expects the analytical selection to remain available.
    if (ctx.previousToolId !== 'selectionPaint') ctx.setAreaSelection?.(null);
    this.visibilityHandler = () => {
      if (document.hidden && this.nudgeGestureActive) {
        this.nudgeGestureActive = false;
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    // Commit any active nudge transaction when switching tools
    if (this.nudgeGestureActive) {
      ctx.commitTransaction();
      this.nudgeGestureActive = false;
    }
    // Cancel any active drag when switching tools
    if (this.drag.kind === 'dragging') {
      interactionSession.reset();
      if (this.isMoveGesture) {
        ctx.abortTransaction();
      }
      this.drag = {
        kind: 'idle',
        pointerId: -1,
        startCanvas: { x: 0, y: 0 },
        startWorld: { x: 0, y: 0 },
        currentCanvas: { x: 0, y: 0 },
        currentWorld: { x: 0, y: 0 },
      };
      this.marqueeActive = false;
      this.isMoveGesture = false;
      this.initialPositions.clear();
      this.hasDuplicated = false;
    }
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    // Capture the semantic modes at pointer-down. Modifier changes during a
    // drag may affect other interactions, but must not make one marquee switch
    // between replace/add/subtract or containment halfway through the gesture.
    this.marqueeOperation = selectionOperationFromModifiers(e);
    this.marqueeContainment = marqueeUsesContainment(loadSettings().layers.marqueeContainment, e);
    ctx.setPointerCapture(e.pointerId);
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    interactionSession.begin(
      (e.pointerType as 'mouse' | 'pen' | 'touch') || 'mouse',
      e.altKey ? 'duplicate-drag' : 'move',
      ctx.snapEnabled,
    );
    interactionSession.updateModifiers(e.shiftKey, e.altKey, e.ctrlKey, e.metaKey);
    this.drag = {
      kind: 'dragging',
      pointerId: e.pointerId,
      startCanvas: canvas,
      startWorld: world,
      currentCanvas: canvas,
      currentWorld: world,
    };
    // Every gesture starts with a clean duplicate handoff, so an interrupted
    // Alt-drag (pointer loss, tool switch, cancel) cannot strand the next one
    // waiting on clone ids that will never arrive.
    this.duplicateSourceIds = [];
    this.awaitingDuplicateHandoff = false;

    // Long-press: only for touch/pen, not mouse
    this.cancelLongPress();
    this.longPressFired = false;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      this.longPressStart = { x: e.clientX, y: e.clientY };
      this.longPressTimer = setTimeout(() => {
        if (this.longPressStart && !this.longPressFired) {
          this.longPressFired = true;
          ctx.showDeepSelectionMenu?.(world, e.clientX, e.clientY);
        }
      }, LONG_PRESS_MS);
    }

    // Once a leaf has been selected through a container, a normal drag that
    // starts on that leaf must continue to address the leaf. The generic hit
    // tester intentionally returns the topmost container for ordinary clicks,
    // which otherwise turns a selected-child drag into a frame drag. Keep
    // modifier-based selection semantics unchanged: Ctrl/Cmd is still the
    // explicit deep-selection gesture and Shift still toggles selection.
    const normalHit = this.resolveHit(world, ctx);
    const selectedLeafHit =
      !e.shiftKey && !e.ctrlKey && !e.metaKey ? this.findSelectedLeafAtPoint(world, ctx) : null;
    const selectedLeafOverridesHit =
      selectedLeafHit !== null &&
      (normalHit?.nodeId !== selectedLeafHit.nodeId ||
        this.isNestedInEditableContainer(selectedLeafHit.nodeId, ctx));
    const hit = selectedLeafOverridesHit ? selectedLeafHit : normalHit;

    if (hit) {
      const docNode = ctx.document.nodes[hit.nodeId];
      if (docNode?.locked) {
        // Clicking a locked node: don't start a move gesture or transaction
        this.marqueeActive = false;
        this.isMoveGesture = false;
        this.initialPositions.clear();
        this.hasDuplicated = false;
        return { consumed: true };
      }

      // B1: Depth-based cycling — if clicking an already-selected single node,
      // cycle to the next overlapping node below
      if (
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !selectedLeafOverridesHit &&
        ctx.isSelected(hit.nodeId) &&
        ctx.selection.length === 1
      ) {
        const allAtPoint = this.findNodesAtPoint(world, ctx);
        const currentIdx = allAtPoint.findIndex((n) => n.nodeId === hit.nodeId);
        if (currentIdx >= 0 && currentIdx < allAtPoint.length - 1) {
          const nextNode = allAtPoint[currentIdx + 1]!;
          ctx.setSelection(nextNode.nodeId);
          ctx.announceSelection([nextNode.node]);
          this.marqueeActive = false;
          this.isMoveGesture = true;
          ctx.beginTransaction();
          this.initialPositions.clear();
          // ctx.selection is a stale snapshot; use the newly-selected id directly.
          const worldMat = nodeWorldTransform(ctx.document, nextNode.nodeId);
          this.initialPositions.set(nextNode.nodeId, { x: worldMat[4], y: worldMat[5] });
          return { consumed: true, captured: true };
        }
      }

      // C3: Ctrl/Cmd+Click deep-selects through containers.
      // When held, select the deepest non-container child at the hit point
      // instead of the topmost container.
      if (e.ctrlKey || e.metaKey) {
        const allAtPoint = this.findNodesAtPoint(world, ctx);
        // `findNodesAtPoint` returns candidates in paint order (topmost
        // first), while the normal hit-test may return the containing frame.
        // Do not start at the normal hit index: that would skip a child that
        // appears before its parent and make Ctrl+Click select the frame.
        // The first non-container candidate is the deepest visible leaf at
        // this point under the established paint ordering.
        let deepTarget: { nodeId: string } | null = null;
        for (const candidate of allAtPoint) {
          const n = ctx.document.nodes[candidate.nodeId];
          if (n && n.kind !== 'frame' && n.kind !== 'group') {
            deepTarget = candidate;
            break;
          }
        }
        const target = deepTarget ?? hit;
        if (e.shiftKey) {
          ctx.toggleSelection(target.nodeId, true);
        } else if (
          !ctx.isSelected(target.nodeId) ||
          // When multi-selecting, Ctrl+drag should move the whole selection,
          // not replace it. Only re-select when single-selecting to keep the
          // selection authoritative (fixes container-hit layers-panel stale).
          ctx.selection.length <= 1
        ) {
          ctx.setSelection(target.nodeId);
        }
      } else if (ctx.touchMultiSelect.active) {
        // Touch multi-select: tap toggles nodes in/out of selection
        if (ctx.isSelected(hit.nodeId)) {
          ctx.toggleSelection(hit.nodeId, false);
        } else {
          ctx.toggleSelection(hit.nodeId, true);
        }
      } else if (e.shiftKey) {
        ctx.toggleSelection(hit.nodeId, true);
      } else if (!ctx.isSelected(hit.nodeId)) {
        ctx.setSelection(hit.nodeId);
      }
      const effectiveNodes = ctx.selection.map((id) => ctx.getNode(id)).filter(Boolean);
      ctx.announceSelection(effectiveNodes as import('@varve/scene').SceneNode[]);
      this.marqueeActive = false;
      this.isMoveGesture = true;
      // Begin transaction for move gesture (undo coherence)
      ctx.beginTransaction();
      // Store initial world-space origin for each selected node so onDragMove
      // can compute newLocalPos = parentInverse * (initWorldPos + totalDelta).
      // ctx.selection is a closure snapshot captured before setSelection/toggleSelection;
      // build the effective post-call set from what we know the new state will be.
      const effectiveIds: string[] = e.shiftKey
        ? ctx.isSelected(hit.nodeId)
          ? ctx.selection.filter((id) => id !== hit.nodeId) // toggle off: removed
          : [...ctx.selection, hit.nodeId] // toggle on: added
        : ctx.isSelected(hit.nodeId)
          ? [...ctx.selection] // already selected: unchanged
          : [hit.nodeId]; // replaced: only the new node
      this.initialPositions.clear();
      for (const id of effectiveIds) {
        const worldMat = nodeWorldTransform(ctx.document, id);
        this.initialPositions.set(id, { x: worldMat[4], y: worldMat[5] });
      }
    } else {
      if (!e.shiftKey && !ctx.touchMultiSelect.active) {
        ctx.setSelection(null);
        ctx.announceSelection([]);
      }
      // M6: clicking a page's trim background activates that page (page
      // navigation and page-scoped commands follow the active page).
      const pageAt = worldToPageAtPoint(ctx.document, world);
      if (pageAt && pageAt.pageId !== ctx.document.activePageId) {
        ctx.setActivePage?.(pageAt.pageId);
      }
      this.marqueeActive = !ctx.touchMultiSelect.active;
      this.isMoveGesture = false;
    }

    return { consumed: true, captured: true };
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressStart = null;
  }

  private findSelectedLeafAtPoint(
    world: { x: number; y: number },
    ctx: ToolContext,
  ): { nodeId: string; node: import('@varve/scene').SceneNode } | null {
    if (ctx.selection.length === 0) return null;
    const selectedIds = new Set(ctx.selection);
    return (
      this.findNodesAtPoint(world, ctx).find(
        (candidate) =>
          selectedIds.has(candidate.nodeId) &&
          candidate.node.kind !== 'frame' &&
          candidate.node.kind !== 'group',
      ) ?? null
    );
  }

  private isNestedInEditableContainer(nodeId: NodeId, ctx: ToolContext): boolean {
    const pageContentRoots = new Set((ctx.document.pages ?? []).map((page) => page.contentRoot));
    let parentId = getParent(ctx.document, nodeId);
    while (parentId) {
      const parent = ctx.document.nodes[parentId];
      if (
        parent &&
        (parent.kind === 'frame' || parent.kind === 'group') &&
        !pageContentRoots.has(parentId)
      ) {
        return true;
      }
      parentId = getParent(ctx.document, parentId);
    }
    return false;
  }

  override onDragMove(ctx: ToolContext): void {
    // Cancel long-press if pointer moves beyond tolerance
    if (this.longPressStart && !this.longPressFired && ctx.lastPointerEvent) {
      const dx = ctx.lastPointerEvent.clientX - this.longPressStart.x;
      const dy = ctx.lastPointerEvent.clientY - this.longPressStart.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
        this.cancelLongPress();
      }
    }

    // Live modifier state for snap bypass
    interactionSession.updateModifiers(ctx.shiftKey, ctx.altKey, ctx.ctrlKey, ctx.metaKey);
    const interaction = interactionSession.freeze();

    if (this.marqueeActive) {
      const rect = this.computeMarqueeRect();
      ctx.setDraft({ kind: 'rect', x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    } else {
      if (interaction.altKey && !this.hasDuplicated) {
        this.duplicateSourceIds = [...ctx.selection];
        ctx.duplicateSelected();
        this.hasDuplicated = true;
        interactionSession.setDuplicate(true);
        this.awaitingDuplicateHandoff = true;
        // duplicateSelected() re-selects the clones via setState, so their ids
        // are not observable until a later event. Moving the still-selected
        // originals on this frame would drag them out from under the copy.
        return;
      }

      // Hand the gesture over to the clones once they become the selection.
      // They inherit the drag origin recorded for the node each was cloned
      // from (duplicateSelected builds the new selection in source order), so
      // they track the pointer from the gesture's start and the originals stay
      // put. Without this the clones have no initialPositions entry, every
      // iteration below hits `continue`, and the copy never follows the
      // pointer at all -- it just sits at duplicateSelected's fixed offset.
      if (this.awaitingDuplicateHandoff) {
        const cloneIds = ctx.selection;
        const sourceIds = this.duplicateSourceIds;
        if (cloneIds.length === 0 || cloneIds.length !== sourceIds.length) {
          // Duplication produced nothing usable — fall back to a plain move.
          this.awaitingDuplicateHandoff = false;
        } else if (cloneIds.every((id, i) => id === sourceIds[i])) {
          return; // clones not committed to state yet
        } else {
          for (let i = 0; i < cloneIds.length; i++) {
            const cloneId = cloneIds[i];
            const sourceId = sourceIds[i];
            if (!cloneId || !sourceId) continue;
            const origin = this.initialPositions.get(sourceId);
            if (origin) this.initialPositions.set(cloneId, origin);
          }
          this.awaitingDuplicateHandoff = false;
        }
      }

      const sel = ctx.selection;
      if (sel.length === 0) return;
      // Total world-space delta from drag origin.
      const totalDelta = this.worldDragDelta(ctx);
      // Calculate selection center for drop target frame detection
      let selCenterX = 0;
      let selCenterY = 0;
      let selCount = 0;
      for (const id of sel) {
        const node = ctx.getNode(id);
        if (!node) continue;
        const bounds = ctx.nodeWorldBounds(node);
        if (bounds) {
          selCenterX += bounds.x + bounds.w / 2;
          selCenterY += bounds.y + bounds.h / 2;
          selCount++;
        }
      }

      // Find drop target frame based on selection center
      if (selCount > 0) {
        selCenterX /= selCount;
        selCenterY /= selCount;
        const dropTarget = ctx.findContainingFrame({ x: selCenterX, y: selCenterY });
        ctx.setDropTargetFrame(dropTarget);
      }

      // Snap the selection as a whole: one world-space response applied to
      // every node. Snapping each node independently lets different members
      // win different snap amounts, tearing relative arrangement apart.
      // The primary (first) node's bounds anchor the response; the snapped
      // delta is then added to every node's target so the selection moves
      // rigidly and only the group's position changes.
      let snapAdjust = { x: 0, y: 0 };
      const primaryId = sel.find((id) => id && this.initialPositions.has(id));
      const primaryInit = primaryId ? this.initialPositions.get(primaryId) : null;
      const primaryNode = primaryId ? ctx.getNode(primaryId) : null;
      if (primaryInit && primaryNode && !interaction.bypassSnap) {
        const primaryBounds = ctx.nodeWorldBounds(primaryNode);
        if (primaryBounds) {
          const unsnappedX = primaryInit.x + totalDelta.dx;
          const unsnappedY = primaryInit.y + totalDelta.dy;
          const snapped = ctx.snapPosition(
            { x: unsnappedX, y: unsnappedY, w: primaryBounds.w, h: primaryBounds.h },
            [],
          );
          snapAdjust = { x: snapped.x - unsnappedX, y: snapped.y - unsnappedY };
        }
      }

      const positions: Array<{ id: string; x: number; y: number }> = [];
      for (const id of sel) {
        const node = ctx.getNode(id);
        if (!node) continue;
        // Compute target world position from stored initial world origin + total delta.
        const initWorld = this.initialPositions.get(id);
        if (!initWorld) continue;
        const newWorldX = initWorld.x + totalDelta.dx + snapAdjust.x;
        const newWorldY = initWorld.y + totalDelta.dy + snapAdjust.y;

        // Convert world target position to the node's parent local space.
        const parentId = getParent(ctx.document, id);
        const toLocal = (wx: number, wy: number): { x: number; y: number } => {
          if (!parentId) return { x: wx, y: wy };
          const local = worldToParent(ctx.document, parentId, [wx, wy]);
          if (!local) return { x: wx, y: wy };
          return { x: local[0], y: local[1] };
        };

        const local = toLocal(newWorldX, newWorldY);
        positions.push({ id, x: local.x, y: local.y });
      }
      // One document update per sample instead of one per node: an N-node
      // selection previously issued N setNodePosition calls, each spreading
      // the whole nodes map (N*O(N) key copies per pointermove).
      if (positions.length > 0) ctx.setNodePositions(positions);
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDropTargetFrame(null);
    if (this.marqueeActive) {
      ctx.setDraft(null);
      const rect = this.computeMarqueeRect();
      // Marquee modifier modes:
      //   No modifier: replace selection based on containment preference
      //   Shift: additive (add to selection)
      //   Alt: subtract (remove from selection)
      //   Shift+Alt: intersect (keep only nodes in both selection and marquee)
      //   Ctrl/Cmd: temporarily toggle containment, independently of the op
      const useContainment = this.marqueeContainment;
      const operation = this.marqueeOperation;
      const entries = walkNodes(ctx.document, activePageNodes(ctx.document));
      const ordered = [...entries.values()].reverse();
      const marqueeIds: string[] = [];
      const parentIndex = buildParentIndexMap(ctx.document);
      const broadPhase = ctx.queryMarqueeCandidates?.(rect);
      for (const entry of rect.w > 0 && rect.h > 0 ? ordered : []) {
        if (!entry) continue;
        if (!isMarqueeSelectableNode(ctx.document, entry.nodeId, parentIndex)) continue;
        if (
          ctx.isolatedNodeId !== undefined &&
          !isInIsolatedSubtree(entry.nodeId, ctx.isolatedNodeId, ctx.document)
        )
          continue;
        if (broadPhase && !broadPhase.has(entry.nodeId)) continue;
        if (marqueeGeometryHit(ctx.document, entry.nodeId, rect, useContainment, parentIndex)) {
          marqueeIds.push(entry.nodeId);
        }
      }
      const nextSelection = commitNodeSelectionOperation(ctx, marqueeIds, operation);
      ctx.announceSelection(
        nextSelection
          .map((id) => ctx.getNode(id))
          .filter((n): n is import('@varve/scene').SceneNode => Boolean(n)),
      );
    } else {
      // After move, re-parent if inside a frame.
      // Hold Ctrl to bypass auto-reparent (Space is used for Hand tool spring).
      const endInteraction = interactionSession.freeze();
      if (!endInteraction.bypassSnap) {
        const sel = ctx.selection;
        if (sel.length >= 1) {
          // Track insertion index per parent so batch inserts into the same
          // target frame use incrementing indices (Fix 4).
          const insertIndexByParent = new Map<string | null, number>();
          for (const selId of sel) {
            if (!selId) continue;
            const node = ctx.getNode(selId);
            if (!node || node.locked || !node.visible) continue;
            // Use world-space center (accounts for parent transforms) for reparent.
            const worldBounds = nodeWorldBounds(ctx.document, selId);
            const center = worldCenterOf(ctx.document, selId, worldBounds);
            const frameId = ctx.findContainingFrame(center);
            if (frameId) {
              const currentParent = getParent(ctx.document, selId);
              if (currentParent !== frameId) {
                // Size heuristic: only reparent if the node is not larger
                // than the target frame (matching Figma/Sketch behaviour).
                const frameNode = ctx.getNode(frameId);
                if (frameNode && frameNode.kind === 'frame') {
                  const fb = nodeWorldBounds(ctx.document, frameId);
                  if (fb && worldBounds) {
                    const nodeArea = worldBounds.w * worldBounds.h;
                    const frameArea = fb.w * fb.h;
                    if (nodeArea > frameArea * 1.1) continue;
                  }
                }
                const baseIndex = childrenCount(ctx.document, frameId);
                const localIndex = insertIndexByParent.get(frameId) ?? 0;
                ctx.reparentNode(selId, frameId, baseIndex + localIndex);
                insertIndexByParent.set(frameId, localIndex + 1);
              }
            } else {
              // No containing frame: resolve the destination page under the
              // drop point and reparent the node to that page's top level —
              // the active page's contentRoot on a pasteboard/active-page
              // drop (null), or the destination page's contentRoot for a
              // cross-page drop (M6). Placement-aware world transforms
              // convert the local transform, so the node keeps its visual
              // world position across the move. A drop on the node's own
              // page top level is a no-op (never reparent to the parent it
              // already has — that would push a redundant document write and
              // a no-op undo entry on top of the real move).
              const currentParent = getParent(ctx.document, selId);
              let destParent: NodeId | null = null;
              let alreadyHome = false;
              const destPage = worldToPageAtPoint(ctx.document, center);
              if (destPage) {
                const dest = ctx.document.pages?.find((p) => p.id === destPage.pageId);
                if (dest) {
                  if (dest.contentRoot === currentParent) {
                    alreadyHome = true;
                  } else if (destPage.pageId === ctx.document.activePageId) {
                    destParent = null;
                  } else {
                    destParent = dest.contentRoot;
                  }
                }
              } else {
                const activePage = ctx.document.pages?.find(
                  (p) => p.id === ctx.document.activePageId,
                );
                if (activePage && currentParent === activePage.contentRoot) alreadyHome = true;
              }
              if (!alreadyHome && destParent !== currentParent) {
                const parentKey = destParent ?? null;
                const baseIndex = ctx.rootNodes().length;
                const localIndex = insertIndexByParent.get(parentKey) ?? 0;
                ctx.reparentNode(selId, destParent, baseIndex + localIndex);
                insertIndexByParent.set(parentKey, localIndex + 1);
              }
            }
          }
          ctx.commitTransaction();
        }
      }

      // The move and its optional reparent are one user gesture. Commit only
      // after the reparent pass has run; committing before it and immediately
      // opening another transaction lets React queue the two updates against
      // the same stale document, so redo restores the moved local transform
      // without restoring the destination parent.
      if (this.isMoveGesture && (endInteraction.bypassSnap || ctx.selection.length === 0)) {
        ctx.commitTransaction();
      }
    }
    this.marqueeActive = false;
    this.isMoveGesture = false;
    this.initialPositions.clear();
    this.hasDuplicated = false;
    interactionSession.reset();
  }

  /**
   * Object marquee modifiers are selection-operation modifiers. Reusing
   * BaseTool.computeDragRect here would make Shift constrain to a square and
   * Alt draw from centre, colliding with add/subtract semantics. Geometry is
   * therefore always the normalized pointer-to-pointer rectangle.
   */
  private computeMarqueeRect(): { x: number; y: number; w: number; h: number } {
    return (
      normalizeMarqueeRect(this.drag.startWorld, this.drag.currentWorld) ?? {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      }
    );
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
    // Abort transaction to revert move
    if (this.isMoveGesture) {
      ctx.abortTransaction();
    }
    this.marqueeActive = false;
    this.isMoveGesture = false;
    this.initialPositions.clear();
    this.hasDuplicated = false;
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    // Tab cycling is handled at the CanvasArea level (DFS paint order).
    // SelectTool does not consume Tab — lets it fall through to the global handler.
    // Research basis: Figma uses sibling-level Tab cycling, but we use DFS
    // (all selectable nodes in paint order) for simplicity and discoverability.
    if (e.key === 'Tab') {
      return false;
    }

    if (e.key.startsWith('Arrow')) {
      const sel = ctx.selection;
      if (sel.length === 0) return false;
      const step = e.shiftKey ? 10 : e.altKey ? 0.5 : 1;
      const direction = e.key.slice('Arrow'.length).toLowerCase() as NudgeDirection;
      if (!['up', 'down', 'left', 'right'].includes(direction)) return false;

      // Key-repeat coalescing: only begin a transaction on the first press.
      // Subsequent repeats share the same transaction; keyup commits it.
      if (!e.repeat) {
        if (this.nudgeGestureActive) {
          ctx.commitTransaction();
          this.nudgeGestureActive = false;
        }
        ctx.beginTransaction();
        this.nudgeGestureActive = true;
        // Announce once per gesture, not once per OS key-repeat (~30 Hz).
        ctx.announceOperation('Nudge', `${step}px`);
      }

      executeNudge(direction, step, {
        document: ctx.document,
        selection: sel,
        getNode: (id) => ctx.getNode(id),
        setNodePosition: (id, x, y) => ctx.setNodePosition(id, x, y),
        setNodePositions: (positions) => ctx.setNodePositions(positions),
      });

      // Auto-reparent after nudge (matching drag-end behavior).
      // Hold Ctrl to bypass (Space is used for Hand tool spring).
      if (!e.repeat && !ctx.ctrlKey) {
        // Collect all pending reparent ops first so we only start a
        // transaction when actual work is needed.
        const reparentOps: Array<{
          id: string;
          parentId: string | null;
          index: number;
        }> = [];
        const insertIndexByParent = new Map<string | null, number>();
        for (const selId of sel) {
          if (!selId) continue;
          const node = ctx.getNode(selId);
          if (!node || node.locked || !node.visible) continue;
          const worldBounds = nodeWorldBounds(ctx.document, selId);
          const center = worldCenterOf(ctx.document, selId, worldBounds);
          const frameId = ctx.findContainingFrame(center);
          const currentParent = getParent(ctx.document, selId);
          if (frameId && currentParent !== frameId) {
            // Size heuristic: only reparent if node is not larger than target frame
            const frameNode = ctx.getNode(frameId);
            if (frameNode && frameNode.kind === 'frame') {
              const fb = nodeWorldBounds(ctx.document, frameId);
              if (fb && worldBounds) {
                const nodeArea = worldBounds.w * worldBounds.h;
                const frameArea = fb.w * fb.h;
                if (nodeArea > frameArea * 1.1) continue;
              }
            }
            const baseIndex = childrenCount(ctx.document, frameId);
            const localIndex = insertIndexByParent.get(frameId) ?? 0;
            reparentOps.push({
              id: selId,
              parentId: frameId,
              index: baseIndex + localIndex,
            });
            insertIndexByParent.set(frameId, localIndex + 1);
          } else {
            // Same top-level equivalence as onDragEnd, destination-aware:
            // a nudge that stays on the node's own page top level is a
            // no-op; a nudge onto another page's trim moves the node to
            // THAT page's contentRoot (world position preserved, M6); a
            // nudge onto the pasteboard pops to the active page's top
            // level (null).
            const currentParent = getParent(ctx.document, selId);
            let destParent: NodeId | null = null;
            let alreadyHome = false;
            const destPage = worldToPageAtPoint(ctx.document, {
              x: center.x,
              y: center.y,
            });
            if (destPage) {
              const dest = ctx.document.pages?.find((p) => p.id === destPage.pageId);
              if (dest) {
                if (dest.contentRoot === currentParent) {
                  alreadyHome = true;
                } else if (destPage.pageId === ctx.document.activePageId) {
                  destParent = null;
                } else {
                  destParent = dest.contentRoot;
                }
              }
            } else {
              const activePage = ctx.document.pages?.find(
                (p) => p.id === ctx.document.activePageId,
              );
              if (activePage && currentParent === activePage.contentRoot) alreadyHome = true;
            }
            if (!alreadyHome && destParent !== currentParent) {
              const parentKey = destParent ?? null;
              const baseIndex = ctx.rootNodes().length;
              const localIndex = insertIndexByParent.get(parentKey) ?? 0;
              reparentOps.push({
                id: selId,
                parentId: destParent,
                index: baseIndex + localIndex,
              });
              insertIndexByParent.set(parentKey, localIndex + 1);
            }
          }
        }
        if (reparentOps.length > 0) {
          ctx.beginTransaction();
          for (const op of reparentOps) {
            ctx.reparentNode(op.id, op.parentId, op.index);
          }
          ctx.commitTransaction();
        }
      } // !ctx.ctrlKey
      return true;
    }
    if (e.key === 'Enter' && !e.repeat) {
      // Enter descends into the selected container (frame/group).
      const sel = ctx.selection;
      if (sel.length === 1) {
        const node = ctx.getNode(sel[0]!);
        if (node && (node.kind === 'frame' || node.kind === 'group')) {
          ctx.enterIsolation?.(sel[0]!);
          ctx.setSelection(sel[0]!);
          ctx.announceOperation('Enter', node.name);
          return true;
        }
      }
    }

    if (e.key === 'Escape') {
      // If mid-nudge, commit the transaction (do not discard user intent)
      if (this.nudgeGestureActive) {
        ctx.commitTransaction();
        this.nudgeGestureActive = false;
        return true;
      }
      // If mid-drag, abort transaction to revert
      if (this.drag.kind === 'dragging' && this.isMoveGesture) {
        ctx.abortTransaction();
        this.drag = {
          kind: 'idle',
          pointerId: -1,
          startCanvas: { x: 0, y: 0 },
          startWorld: { x: 0, y: 0 },
          currentCanvas: { x: 0, y: 0 },
          currentWorld: { x: 0, y: 0 },
        };
        this.marqueeActive = false;
        this.isMoveGesture = false;
        this.initialPositions.clear();
        this.hasDuplicated = false;
        return true;
      }
      if (ctx.isolatedNodeId) {
        const isolatedNodeId = ctx.isolatedNodeId;
        ctx.exitIsolation?.();
        ctx.setSelection(isolatedNodeId);
        ctx.announceOperation('Exit isolation', 'Clipping group');
        return true;
      }
      ctx.setSelection(null);
      ctx.announceSelection([]);
      return true;
    }
    return false;
  }

  override onKeyUp(e: KeyboardEvent, ctx: ToolContext): void {
    if (this.nudgeGestureActive && e.key.startsWith('Arrow')) {
      ctx.commitTransaction();
      this.nudgeGestureActive = false;
    }
  }

  /**
   * B2: Resolve click target, skipping transparent/stroke-only nodes that
   * should pass through to the next opaque node below.
   * @param world World-space point.
   * @param ctx Tool context.
   * @param policyName Optional hit-test policy name (hover, click, touch, etc).
   *   When omitted, uses the default click policy.
   */
  private resolveHit(
    world: { x: number; y: number },
    ctx: ToolContext,
    policyName?: import('../hitTest').HitTestPolicyName,
  ): { nodeId: string; node: import('@varve/scene').SceneNode } | null {
    const hit =
      policyName && ctx.hitTestWithPolicy
        ? ctx.hitTestWithPolicy(world, policyName)
        : ctx.hitTest(world);
    if (!hit) return null;

    // Filter hit-test result by isolation mode
    if (
      ctx.isolatedNodeId !== undefined &&
      !isInIsolatedSubtree(hit.nodeId, ctx.isolatedNodeId, ctx.document)
    ) {
      return null;
    }

    // Check if the hit node has transparent or no fill
    const node = ctx.getNode(hit.nodeId);
    if (node && isTransparentOrEmptyFill(node)) {
      // Pass through: find next opaque node at this point
      const allAtPoint = this.findNodesAtPoint(world, ctx);
      const hitIdx = allAtPoint.findIndex((n) => n.nodeId === hit.nodeId);
      for (let i = hitIdx + 1; i < allAtPoint.length; i++) {
        const candidate = allAtPoint[i]!;
        const n = ctx.getNode(candidate.nodeId);
        if (n && !isTransparentOrEmptyFill(n)) {
          return { nodeId: candidate.nodeId, node: candidate.node };
        }
      }
      // No opaque node found beneath, return the original hit
      return hit;
    }
    return hit;
  }

  /** Find all visible unlocked nodes at a world point, in paint order (topmost last). */
  private findNodesAtPoint(
    world: { x: number; y: number },
    ctx: ToolContext,
  ): Array<{ nodeId: string; node: import('@varve/scene').SceneNode }> {
    const results: Array<{ nodeId: string; node: import('@varve/scene').SceneNode }> = [];
    const entries = walkNodes(ctx.document, activePageNodes(ctx.document));
    // Screen-pixel threshold for path hit-testing (world units at current zoom).
    const pathThresh = 6 / Math.max(0.001, ctx.zoom);
    // Reverse for paint order (later siblings on top)
    for (const entry of [...entries.values()].reverse()) {
      if (!entry) continue;
      if (entry.node.locked || !entry.node.visible) continue;
      // Filter by isolation mode
      if (
        ctx.isolatedNodeId !== undefined &&
        !isInIsolatedSubtree(entry.nodeId, ctx.isolatedNodeId, ctx.document)
      )
        continue;
      const bbox = ctx.nodeWorldBounds(entry.node);
      if (!bbox) continue;
      // F: Path ray-cast — use segment distance test instead of bbox alone
      if (entry.node.kind === 'shape' && entry.node.shape?.kind === 'path') {
        if (isPointNearPath(world, entry.node, entry.nodeId, ctx.document, pathThresh)) {
          results.push({ nodeId: entry.nodeId, node: entry.node });
        }
        continue;
      }
      if (rectContains(bbox, [world.x, world.y])) {
        results.push({ nodeId: entry.nodeId, node: entry.node });
        continue;
      }
      // Zoom-aware tolerance: at low zoom, expand the bbox by screen-pixel
      // tolerance so visually-small objects are still selectable.
      const tol = 8 / Math.max(0.001, ctx.zoom);
      if (tol > 0) {
        const expanded = {
          x: bbox.x - tol,
          y: bbox.y - tol,
          w: bbox.w + 2 * tol,
          h: bbox.h + 2 * tol,
        };
        if (rectContains(expanded, [world.x, world.y])) {
          results.push({ nodeId: entry.nodeId, node: entry.node });
        }
      }
    }
    return results;
  }

  override onDoubleClick(e: PointerEvent, ctx: ToolContext): void {
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    const hit = ctx.hitTest(world);
    if (hit) {
      const node = ctx.getNode(hit.nodeId);
      let clippingGroupId: NodeId | undefined;
      if (!ctx.isolatedNodeId) {
        let ancestorId = getParent(ctx.document, hit.nodeId);
        while (ancestorId) {
          const ancestor = ctx.getNode(ancestorId);
          if ((ancestor?.kind === 'group' || ancestor?.kind === 'frame') && ancestor.mask) {
            clippingGroupId = ancestorId;
            break;
          }
          ancestorId = getParent(ctx.document, ancestorId);
        }
      }
      if (clippingGroupId) {
        const clippingGroup = ctx.getNode(clippingGroupId);
        const maskSourceId =
          clippingGroup?.kind === 'group' || clippingGroup?.kind === 'frame'
            ? clippingGroup.mask?.sourceNodeId
            : undefined;
        ctx.enterIsolation?.(clippingGroupId);
        ctx.setSelection(maskSourceId ?? clippingGroupId);
        ctx.announceOperation('Edit clipping mask', clippingGroup?.name ?? 'Clipping group');
        return;
      }
      if (node && node.kind === 'text') {
        ctx.announceOperation('Edit Text', node.name);
        ctx.setTextEditTargetId(hit.nodeId);
        ctx.setSelection(hit.nodeId);
      } else if (node && node.kind === 'table') {
        // ADR-0016: double-click enters table edit mode (cell selection,
        // keyboard navigation, structural ops).
        ctx.setSelection(hit.nodeId);
        ctx.setTableEdit?.({
          tableId: hit.nodeId,
          cellIds: [],
          activeCellId: null,
          editingCellId: null,
          anchorCellId: null,
        });
        ctx.announceOperation('Edit Table', node.name);
      } else if (node && (node.kind === 'frame' || node.kind === 'group')) {
        ctx.enterIsolation?.(hit.nodeId);
        ctx.setSelection(hit.nodeId);
        ctx.announceOperation('Enter', node.name);
      } else if (node && node.kind === 'shape' && node.shape.kind === 'path') {
        ctx.setNodeEditTargetId(hit.nodeId);
        ctx.setTool('nodeEdit');
        ctx.announceOperation('Node Edit', node.name);
      }
    }
  }
}

/** Check if a node has transparent fill or no fills (stroke-only). */
function isTransparentOrEmptyFill(node: import('@varve/scene').SceneNode): boolean {
  if (node.kind !== 'shape') return false;
  // Check fills array first, fall back to legacy `fill` field
  if (node.fills && node.fills.length > 0) {
    return node.fills.every((f: import('@varve/scene').Fill) => {
      if (f.type === 'solid' && f.color) {
        const [, , , a] = managedColorToRgba(f.color);
        return a === 0;
      }
      return false;
    });
  }
  if (node.fill) {
    if (typeof node.fill === 'object' && !Array.isArray(node.fill)) {
      const [, , , a] = managedColorToRgba(node.fill);
      return a === 0;
    }
    const alpha = Array.isArray(node.fill) ? (node.fill[3] ?? 255) : 255;
    return alpha === 0;
  }
  // No fills array and no fill field = stroke-only, treat as transparent
  return true;
}

/** F: Check if a world-space point is near any segment of a path node. */
function isPointNearPath(
  world: { x: number; y: number },
  node: import('@varve/scene').SceneNode,
  nodeId: string,
  doc: import('@varve/scene').Document,
  threshold: number,
): boolean {
  if (node.kind !== 'shape' || node.shape.kind !== 'path') return false;
  const points = node.shape.points;
  if (!points || points.length < 2) return false;

  const worldMat = nodeWorldTransform(doc, nodeId);
  const invMat = invertAffine(worldMat);
  if (!invMat) return false;

  const localPt = applyAffine(invMat, [world.x, world.y]);

  for (let i = 0; i < points.length; i++) {
    const from = points[i]!;
    const to = points[(i + 1) % points.length]!;

    // Check bezier segment if handles exist
    if (from.handleOut || to.handleIn) {
      const bez = pathPointToBezier(from, to);
      const closest = cubicBezierClosestPoint(bez, { x: localPt[0], y: localPt[1] });
      if (closest.dist <= threshold * threshold) return true;
    } else {
      const distSq = pointToSegmentDistSq([from.x, from.y], [to.x, to.y], [localPt[0], localPt[1]]);
      if (distSq <= threshold * threshold) return true;
    }
  }
  return false;
}

function childrenCount(
  doc: { nodes: Record<string, { id: string; children?: string[] }> },
  id: string,
): number {
  const node = doc.nodes[id];
  if (!node?.children) return 0;
  return node.children.length;
}
