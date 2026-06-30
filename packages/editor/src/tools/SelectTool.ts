/**
 * SelectTool — selection, move, marquee.
 *
 * Gesture states: idle → (click empty → deselect) | (click node → select)
 *                 | (drag node → move) | (drag empty → marquee)
 *
 * Research basis: Figma Move tool (V), Illustrator selection tool.
 *                 Marquee: rubber-band selection with Shift-additive.
 *                 Never creates shapes.
 */
import { getParent } from '@strata/scene';
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

    const hit = ctx.hitTest(world);

    if (hit) {
      const docNode = ctx.document.nodes[hit.nodeId];
      if (docNode?.locked) return { consumed: true };
      if (e.shiftKey) {
        ctx.toggleSelection(hit.nodeId, true);
      } else if (!ctx.isSelected(hit.nodeId)) {
        ctx.setSelection(hit.nodeId);
      }
      ctx.announceSelection([hit.node]);
      this.marqueeActive = false;
    } else {
      if (!e.shiftKey) {
        ctx.setSelection(null);
        ctx.announceSelection([]);
      }
      this.marqueeActive = true;
    }

    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.marqueeActive) {
      const rect = this.computeDragRect(ctx);
      ctx.setDraft({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    } else {
      const sel = ctx.selection;
      if (sel.length === 0) return;
      const delta = ctx.canvasDeltaToWorld(
        this.drag.currentCanvas.x - this.drag.startCanvas.x,
        this.drag.currentCanvas.y - this.drag.startCanvas.y,
      );
      const allBounds: Array<{ id: string; b: { x: number; y: number; w: number; h: number } }> =
        [];
      for (const n of Object.values(ctx.document.nodes)) {
        const b = ctx.nodeWorldBounds(n);
        if (b) allBounds.push({ id: n.id, b });
      }
      for (const id of sel) {
        const node = ctx.getNode(id);
        if (!node) continue;
        const newX = node.transform[4] + delta.dx;
        const newY = node.transform[5] + delta.dy;
        const thisBounds = ctx.nodeWorldBounds(node);
        if (thisBounds) {
          const otherBounds = allBounds.filter((entry) => entry.id !== id).map((entry) => entry.b);
          if (otherBounds.length > 0) {
            const snapped = ctx.snapPosition(
              { x: newX, y: newY, w: thisBounds.w, h: thisBounds.h },
              otherBounds,
            );
            ctx.setNodePosition(id, snapped.x, snapped.y);
            continue;
          }
        }
        ctx.setNodePosition(id, newX, newY);
      }
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    if (this.marqueeActive) {
      ctx.setDraft(null);
      const rect = this.computeDragRect(ctx);
      const nodes = ctx.rootNodes();
      const selectedIds: string[] = [];
      for (const n of nodes) {
        const bbox = ctx.nodeWorldBounds(n);
        if (bbox && rectsIntersect(rect, bbox)) {
          selectedIds.push(n.id);
        }
      }
      if (selectedIds.length > 0) {
        const first = selectedIds[0]!;
        ctx.setSelection(first);
        for (let i = 1; i < selectedIds.length; i++) {
          const id = selectedIds[i];
          if (!id) throw new Error('selected id not found');
          ctx.toggleSelection(id, true);
        }
        const selectedNodes = selectedIds
          .map((id) => ctx.getNode(id))
          .filter((n): n is import('@strata/scene').SceneNode => Boolean(n));
        ctx.announceSelection(selectedNodes);
      }
    } else {
      // After move, re-parent if inside a frame
      const sel = ctx.selection;
      if (sel.length === 1) {
        const selId = sel[0];
        if (!selId) throw new Error('selection id not found');
        const node = ctx.getNode(selId);
        if (node) {
          const centerX = node.transform[4];
          const centerY = node.transform[5];
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
      }
    }
    this.marqueeActive = false;
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
    this.marqueeActive = false;
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key.startsWith('Arrow')) {
      const sel = ctx.selection;
      if (sel.length === 0) return false;
      const step = e.shiftKey ? 10 : e.altKey ? 0.5 : 1;
      for (const id of sel) {
        const node = ctx.getNode(id);
        if (!node) continue;
        const t = node.transform;
        ctx.setNodePosition(
          id,
          t[4] + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0),
          t[5] + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0),
        );
      }
      ctx.announceOperation('Nudge', `${step}px`);
      return true;
    }
    if (e.key === 'Escape') {
      ctx.setSelection(null);
      ctx.announceSelection([]);
      return true;
    }
    return false;
  }

  override onDoubleClick(e: PointerEvent, ctx: ToolContext): void {
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    const hit = ctx.hitTest(world);
    if (hit) {
      const node = ctx.getNode(hit.nodeId);
      if (node && (node.kind === 'frame' || node.kind === 'group')) {
        ctx.announceOperation('Enter', node.name);
      }
    }
  }
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
