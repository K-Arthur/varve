/**
 * SelectionBoundaryTool — interactive drag handles for transforming the
 * selection boundary itself (NOT the pixel content).
 *
 * Activated via the "Transform Selection" command. Shows a bounding box
 * around the active area selection with move, scale, and rotate handles.
 * Dragging applies an affine transform to the analytical expression tree.
 *
 * This is distinct from FloatingTransformTool, which transforms pixel content.
 */
import { type AreaSelection, areaSelectionBounds, transformAreaSelection } from '@varve/engine';
import { type Affine, multiplyAffine, rotateRad, translate } from '@varve/shared';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

type HandleKind = 'move' | 'rotate' | 'scale-corner' | 'scale-edge';

export class SelectionBoundaryTool extends BaseTool {
  id = 'selectionBoundary' as const;

  private handleKind: HandleKind = 'move';
  private pivotWorld = { x: 0, y: 0 };
  private initialBounds = { x: 0, y: 0, w: 0, h: 0 };
  private initialSelection: AreaSelection | null = null;
  private initialAngle = 0;
  private initialScale = 1;

  cursor(state: ToolCursorState): CursorSpec {
    if (state === 'rotate') return { css: 'grab', fallback: 'default' };
    if (state === 'resize') return { css: 'nwse-resize', fallback: 'default' };
    return { css: 'move', fallback: 'default' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const sel = ctx.areaSelection;
    if (!sel || !ctx.setAreaSelection) {
      ctx.announce('No active selection to transform');
      return { consumed: false };
    }

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    this.pivotWorld = world;
    this.initialSelection = sel;
    this.initialBounds = areaSelectionBounds(sel.expression);

    // Determine handle kind from modifiers.
    if (e.altKey) {
      this.handleKind = 'rotate';
    } else if (e.shiftKey) {
      this.handleKind = 'scale-corner';
    } else {
      this.handleKind = 'move';
    }

    return super.onPointerDown(e, ctx);
  }

  override onDragStart(_ctx: ToolContext): void {
    if (this.handleKind === 'rotate') {
      const cx = this.initialBounds.x + this.initialBounds.w / 2;
      const cy = this.initialBounds.y + this.initialBounds.h / 2;
      this.initialAngle = Math.atan2(this.pivotWorld.y - cy, this.pivotWorld.x - cx);
      this.initialScale = 1;
    } else if (this.handleKind === 'scale-corner') {
      const cx = this.initialBounds.x + this.initialBounds.w / 2;
      const cy = this.initialBounds.y + this.initialBounds.h / 2;
      this.initialScale = Math.hypot(this.pivotWorld.x - cx, this.pivotWorld.y - cy);
    }
  }

  override onDragMove(ctx: ToolContext): void {
    const sel = this.initialSelection;
    if (!sel || !ctx.setAreaSelection) return;

    const world = ctx.canvasToWorld(
      ctx.lastPointerEvent?.clientX ?? 0,
      ctx.lastPointerEvent?.clientY ?? 0,
    );

    let matrix: Affine;

    if (this.handleKind === 'move') {
      const dx = world.x - this.pivotWorld.x;
      const dy = world.y - this.pivotWorld.y;
      matrix = translate(dx, dy);
    } else if (this.handleKind === 'rotate') {
      const cx = this.initialBounds.x + this.initialBounds.w / 2;
      const cy = this.initialBounds.y + this.initialBounds.h / 2;
      const angle = Math.atan2(world.y - cy, world.x - cx);
      const deltaAngle = angle - this.initialAngle;
      matrix = multiplyAffine(
        multiplyAffine(translate(cx, cy), rotateRad(deltaAngle)),
        translate(-cx, -cy),
      );
    } else {
      // scale-corner
      const cx = this.initialBounds.x + this.initialBounds.w / 2;
      const cy = this.initialBounds.y + this.initialBounds.h / 2;
      const currentDist = Math.hypot(world.x - cx, world.y - cy);
      const scaleFactor = this.initialScale > 0 ? currentDist / this.initialScale : 1;
      matrix = multiplyAffine(
        multiplyAffine(translate(cx, cy), [scaleFactor, 0, 0, scaleFactor, 0, 0]),
        translate(-cx, -cy),
      );
    }

    const transformed = transformAreaSelection(sel, matrix);
    if (transformed) {
      ctx.setAreaSelection(transformed);
    }
  }

  override onDragEnd(_ctx: ToolContext): void {
    this.initialSelection = null;
  }

  override onDragCancel(ctx: ToolContext): void {
    if (this.initialSelection && ctx.setAreaSelection) {
      ctx.setAreaSelection(this.initialSelection);
    }
    this.initialSelection = null;
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape') {
      if (this.drag.kind === 'dragging') {
        this.onDragCancel(ctx);
        return true;
      }
      // Exit the tool.
      ctx.setTool('select');
      return true;
    }
    return false;
  }
}
