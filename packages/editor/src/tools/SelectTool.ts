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

import { applyAffine, invertAffine, rectContains } from '@strata/engine';
import { activePageNodes, getParent, walkNodes } from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

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
  private isMoveGesture = false;
  private initialPositions = new Map<string, { x: number; y: number }>();
  private hasDuplicated = false;

  override onDeactivate(ctx: ToolContext): void {
    // Cancel any active drag when switching tools
    if (this.drag.kind === 'dragging') {
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
    ctx.setPointerCapture(e.pointerId);
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    this.drag = {
      kind: 'dragging',
      pointerId: e.pointerId,
      startCanvas: canvas,
      startWorld: world,
      currentCanvas: canvas,
      currentWorld: world,
    };

    const hit = this.resolveHit(world, ctx);

    if (hit) {
      const docNode = ctx.document.nodes[hit.nodeId];
      if (docNode?.locked) return { consumed: true };

      // B1: Depth-based cycling — if clicking an already-selected single node,
      // cycle to the next overlapping node below
      if (!e.shiftKey && ctx.isSelected(hit.nodeId) && ctx.selection.length === 1) {
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

      if (e.shiftKey) {
        ctx.toggleSelection(hit.nodeId, true);
      } else if (!ctx.isSelected(hit.nodeId)) {
        ctx.setSelection(hit.nodeId);
      }
      ctx.announceSelection([hit.node]);
      this.marqueeActive = false;
      this.isMoveGesture = true;
      // Begin transaction for move gesture (undo coherence)
      ctx.beginTransaction();
      // Store initial world-space origin for each selected node so onDragMove
      // can compute newLocalPos = parentInverse * (initWorldPos + totalDelta).
      // ctx.selection is a closure snapshot captured before setSelection/toggleSelection;
      // build the effective post-call set from what we know the new state will be.
      const effectiveIds: string[] = e.shiftKey
        ? [...ctx.selection, hit.nodeId] // additive: prior + newly toggled
        : ctx.isSelected(hit.nodeId)
          ? [...ctx.selection] // already selected: unchanged
          : [hit.nodeId]; // replaced: only the new node
      this.initialPositions.clear();
      for (const id of effectiveIds) {
        const worldMat = nodeWorldTransform(ctx.document, id);
        this.initialPositions.set(id, { x: worldMat[4], y: worldMat[5] });
      }
    } else {
      if (!e.shiftKey) {
        ctx.setSelection(null);
        ctx.announceSelection([]);
      }
      this.marqueeActive = true;
      this.isMoveGesture = false;
    }

    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.marqueeActive) {
      const rect = this.computeDragRect(ctx);
      ctx.setDraft({ kind: 'rect', x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    } else {
      // Alt-duplicate: clone selected nodes once per gesture
      if (ctx.altKey && !this.hasDuplicated) {
        ctx.duplicateSelected();
        this.hasDuplicated = true;
      }

      const sel = ctx.selection;
      if (sel.length === 0) return;
      // Total world-space delta from drag origin.
      const totalDelta = ctx.canvasDeltaToWorld(
        this.drag.currentCanvas.x - this.drag.startCanvas.x,
        this.drag.currentCanvas.y - this.drag.startCanvas.y,
      );
      const allBounds: Array<{ id: string; b: { x: number; y: number; w: number; h: number } }> =
        [];
      for (const n of Object.values(ctx.document.nodes)) {
        const b = ctx.nodeWorldBounds(n);
        if (b) allBounds.push({ id: n.id, b });
      }
      const selectedIds = new Set(sel);
      for (const id of sel) {
        const node = ctx.getNode(id);
        if (!node) continue;
        // Compute target world position from stored initial world origin + total delta.
        const initWorld = this.initialPositions.get(id);
        if (!initWorld) continue;
        const newWorldX = initWorld.x + totalDelta.dx;
        const newWorldY = initWorld.y + totalDelta.dy;

        // Convert world target position to the node's parent local space.
        const parentId = getParent(ctx.document, id);
        const toLocal = (wx: number, wy: number): { x: number; y: number } => {
          if (!parentId) return { x: wx, y: wy };
          const pWorld = nodeWorldTransform(ctx.document, parentId);
          const pInv = invertAffine(pWorld);
          const local = applyAffine(pInv, [wx, wy]);
          return { x: local[0], y: local[1] };
        };

        const thisBounds = ctx.nodeWorldBounds(node);
        if (thisBounds) {
          const otherBounds = allBounds
            .filter(
              (entry) => !selectedIds.has(entry.id) && !(ctx.isSnapExcluded?.(entry.id) ?? false),
            )
            .map((entry) => entry.b);
          if (otherBounds.length > 0) {
            const snapped = ctx.snapPosition(
              { x: newWorldX, y: newWorldY, w: thisBounds.w, h: thisBounds.h },
              otherBounds,
            );
            const local = toLocal(snapped.x, snapped.y);
            ctx.setNodePosition(id, local.x, local.y);
            continue;
          }
        }
        const local = toLocal(newWorldX, newWorldY);
        ctx.setNodePosition(id, local.x, local.y);
      }
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    if (this.marqueeActive) {
      ctx.setDraft(null);
      const rect = this.computeDragRect(ctx);
      // A3: Alt key → fully-contained marquee mode
      const useContainment = ctx.altKey;
      // Iterate the active page's nodes (including nested) via walkNodes.
      // Scoped so marquee-select can't pick up shapes from other pages that
      // happen to occupy the same on-screen coordinates.
      const entries = walkNodes(ctx.document, activePageNodes(ctx.document));
      // Sort by paint order (last sibling = topmost), not by depth.
      // walkNodes returns DFS ancestors-first; reverse so later siblings win.
      const ordered = [...entries.values()].reverse();
      const selectedIds: string[] = [];
      for (const entry of ordered) {
        if (!entry) continue;
        const node = entry.node;
        if (node.locked || !node.visible) continue;
        const bbox = ctx.nodeWorldBounds(node);
        if (bbox) {
          if (useContainment) {
            // Fully contained: the node's bbox must be completely inside the
            // marquee (rectContains takes [x, y] tuples).
            if (
              rectContains(rect, [bbox.x, bbox.y]) &&
              rectContains(rect, [bbox.x + bbox.w, bbox.y + bbox.h])
            ) {
              selectedIds.push(entry.nodeId);
            }
          } else if (rectsIntersect(rect, bbox)) {
            selectedIds.push(entry.nodeId);
          }
        }
      }
      if (selectedIds.length > 0) {
        // Shift: add to existing selection, otherwise replace
        if (!ctx.shiftKey) {
          ctx.setSelection(null);
        }
        for (const id of selectedIds) {
          ctx.toggleSelection(id, true);
        }
        const selectedNodes = selectedIds
          .map((id) => ctx.getNode(id))
          .filter((n): n is import('@strata/scene').SceneNode => Boolean(n));
        ctx.announceSelection(selectedNodes);
      }
    } else {
      // Commit transaction for move gesture
      if (this.isMoveGesture) {
        ctx.commitTransaction();
      }
      // After move, re-parent if inside a frame
      const sel = ctx.selection;
      if (sel.length >= 1) {
        ctx.beginTransaction();
        for (const selId of sel) {
          if (!selId) continue;
          const node = ctx.getNode(selId);
          if (!node || node.locked || !node.visible) continue;
          // Use world-space center (accounts for parent transforms) for reparent.
          const worldBounds = nodeWorldBounds(ctx.document, selId);
          let centerX = node.transform[4];
          let centerY = node.transform[5];
          if (worldBounds) {
            centerX = worldBounds.x + worldBounds.w / 2;
            centerY = worldBounds.y + worldBounds.h / 2;
          }
          const frameId = ctx.findContainingFrame({ x: centerX, y: centerY });
          if (frameId) {
            const currentParent = getParent(ctx.document, selId);
            if (currentParent !== frameId) {
              ctx.reparentNode(selId, frameId, childrenCount(ctx.document, frameId));
            }
          } else {
            const currentParent = getParent(ctx.document, selId);
            if (currentParent !== null) {
              ctx.reparentNode(selId, null, ctx.rootNodes().length);
            }
          }
        }
        ctx.commitTransaction();
      }
    }
    this.marqueeActive = false;
    this.isMoveGesture = false;
    this.initialPositions.clear();
    this.hasDuplicated = false;
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
    // B4: Tab/Shift+Tab cycles through visible unlocked nodes
    if (e.key === 'Tab') {
      const nodes = ctx.rootNodes().filter((n) => n.visible && !n.locked);
      if (nodes.length === 0) return true;
      const firstId = nodes[0]?.id ?? null;
      if (ctx.selection.length === 0) {
        ctx.setSelection(firstId);
        if (firstId) ctx.announceSelection([nodes[0]!]);
      } else {
        const currentIndex = nodes.findIndex((n) => ctx.selection.includes(n.id));
        if (currentIndex === -1) {
          ctx.setSelection(firstId);
          if (firstId) ctx.announceSelection([nodes[0]!]);
        } else {
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + nodes.length) % nodes.length
            : (currentIndex + 1) % nodes.length;
          const nextId = nodes[nextIndex]?.id ?? null;
          ctx.setSelection(nextId);
          if (nextId) ctx.announceSelection([nodes[nextIndex]!]);
        }
      }
      return true;
    }

    if (e.key.startsWith('Arrow')) {
      const sel = ctx.selection;
      if (sel.length === 0) return false;
      const step = e.shiftKey ? 10 : e.altKey ? 0.5 : 1;
      ctx.beginTransaction();
      for (const id of sel) {
        const node = ctx.getNode(id);
        if (!node) continue;
        const t = node.transform;
        // A2: Nudge along local affine axes (supports rotated nodes)
        const [a, b, c, d] = t;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        // Transform nudge vector by local axes: [a, b] for X, [c, d] for Y
        ctx.setNodePosition(id, t[4] + dx * a + dy * c, t[5] + dx * b + dy * d);
      }
      ctx.commitTransaction();
      // Auto-reparent after nudge (matching drag-end behavior).
      // Collect all pending reparent ops first so we only start a
      // transaction when actual work is needed.
      const reparentOps: Array<{
        id: string;
        parentId: string | null;
        index: number;
      }> = [];
      for (const selId of sel) {
        if (!selId) continue;
        const node = ctx.getNode(selId);
        if (!node || node.locked || !node.visible) continue;
        const worldBounds = nodeWorldBounds(ctx.document, selId);
        let centerX = node.transform[4];
        let centerY = node.transform[5];
        if (worldBounds) {
          centerX = worldBounds.x + worldBounds.w / 2;
          centerY = worldBounds.y + worldBounds.h / 2;
        }
        const frameId = ctx.findContainingFrame({ x: centerX, y: centerY });
        const currentParent = getParent(ctx.document, selId);
        if (frameId && currentParent !== frameId) {
          reparentOps.push({
            id: selId,
            parentId: frameId,
            index: childrenCount(ctx.document, frameId),
          });
        } else if (!frameId && currentParent !== null) {
          reparentOps.push({
            id: selId,
            parentId: null,
            index: ctx.rootNodes().length,
          });
        }
      }
      if (reparentOps.length > 0) {
        ctx.beginTransaction();
        for (const op of reparentOps) {
          ctx.reparentNode(op.id, op.parentId, op.index);
        }
        ctx.commitTransaction();
      }
      ctx.announceOperation('Nudge', `${step}px`);
      return true;
    }
    if (e.key === 'Escape') {
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
      }
      ctx.setSelection(null);
      ctx.announceSelection([]);
      return true;
    }
    return false;
  }

  /**
   * B2: Resolve click target, skipping transparent/stroke-only nodes that
   * should pass through to the next opaque node below.
   */
  private resolveHit(
    world: { x: number; y: number },
    ctx: ToolContext,
  ): { nodeId: string; node: import('@strata/scene').SceneNode } | null {
    const hit = ctx.hitTest(world);
    if (!hit) return null;
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

  /** Find all visible unlock nodes at a world point, in paint order (topmost last). */
  private findNodesAtPoint(
    world: { x: number; y: number },
    ctx: ToolContext,
  ): Array<{ nodeId: string; node: import('@strata/scene').SceneNode }> {
    const results: Array<{ nodeId: string; node: import('@strata/scene').SceneNode }> = [];
    // Scoped to the active page — see the marquee-select comment above.
    const entries = walkNodes(ctx.document, activePageNodes(ctx.document));
    // Reverse for paint order (later siblings on top)
    for (const entry of [...entries.values()].reverse()) {
      if (!entry) continue;
      if (entry.node.locked || !entry.node.visible) continue;
      const bbox = ctx.nodeWorldBounds(entry.node);
      if (bbox && rectContains(bbox, [world.x, world.y])) {
        results.push({ nodeId: entry.nodeId, node: entry.node });
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
      if (node && node.kind === 'text') {
        ctx.announceOperation('Edit Text', node.name);
        ctx.setTextEditTargetId(hit.nodeId);
        ctx.setSelection(hit.nodeId);
      } else if (node && (node.kind === 'frame' || node.kind === 'group')) {
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
function isTransparentOrEmptyFill(node: import('@strata/scene').SceneNode): boolean {
  if (node.kind !== 'shape') return false;
  // Check fills array first, fall back to legacy `fill` field
  if (node.fills && node.fills.length > 0) {
    return node.fills.every((f: import('@strata/scene').Fill) => {
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

function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function childrenCount(
  doc: { nodes: Record<string, { id: string; children?: string[] }> },
  id: string,
): number {
  const node = doc.nodes[id];
  if (!node?.children) return 0;
  return node.children.length;
}
