/**
 * EllipseTool — drag to size, Shift=circle, Alt=from-center.
 *
 * When an isometric construction plane is active the ellipse is the exact
 * affine image of a plane circle: the outline is emitted as a closed path of
 * cubic Bézier segments whose control points are mapped through the plane
 * basis. Holding Shift preserves a circle in *plane* coordinates.
 *
 * Research basis: Figma Ellipse (O), Illustrator Ellipse (L), Affinity
 * "Edit in Plane".
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

const DRAFT_SAMPLES = 48;

export class EllipseTool extends BaseTool {
  id = 'ellipse' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onDragMove(ctx: ToolContext): void {
    const planeEllipse = this.planeEllipseDraft(ctx);
    if (planeEllipse) {
      ctx.setDraft({
        kind: 'freehand',
        points: planeEllipse.points,
        label: `${Math.round(planeEllipse.rx)} × ${Math.round(planeEllipse.ry)}`,
      });
      return;
    }
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({
      kind: 'ellipse',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      label: `${Math.round(rect.w)} x ${Math.round(rect.h)}`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const ellipse = this.computePlaneEllipsePoints(ctx);
    if (ellipse) {
      const parentId = this.commitToParent(ellipse.origin, ctx);
      ctx.createShapeAt(ellipse.origin, undefined, parentId, ellipse.points, true);
      return;
    }
    const rect = this.computeDragRect(ctx);
    const parentId = this.commitToParent({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, ctx);
    if (this.isBelowThreshold(ctx)) {
      ctx.createShapeAt(this.drag.startWorld, undefined, parentId);
    } else if (rect.w > 0 && rect.h > 0) {
      ctx.createShapeAt({ x: rect.x, y: rect.y }, { w: rect.w, h: rect.h }, parentId);
    }
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  /**
   * Live outline preview: samples the plane circle and maps each sample
   * through the plane basis, so the draft shows the projected ellipse while
   * dragging (the committed node uses exact cubic segments).
   */
  private planeEllipseDraft(
    ctx: ToolContext,
  ): { points: Array<{ x: number; y: number }>; rx: number; ry: number } | null {
    const drag = this.computePlaneDrag(ctx);
    const toWorld = ctx.planeToWorld;
    if (!drag || !toWorld) return null;
    const rx = drag.du / 2;
    const ry = drag.dv / 2;
    if (!(rx > 0) || !(ry > 0)) return null;
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= DRAFT_SAMPLES; i++) {
      const t = (i / DRAFT_SAMPLES) * Math.PI * 2;
      const world = toWorld({
        u: drag.centreU + Math.cos(t) * rx,
        v: drag.centreV + Math.sin(t) * ry,
      });
      if (!world) return null;
      points.push(world);
    }
    return { points, rx, ry };
  }
}
