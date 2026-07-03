/**
 * PatchTool — region-based correction tool.
 *
 * First drag selects the source region (rectangle). After selection,
 * click to position the patch over the target area. The patch is
 * composited with edge feathering for seamless correction.
 *
 * Research basis: Photoshop Patch tool, GIMP Clone tool (perspective).
 */
import { createBrushMask, patchRegion } from '@strata/engine';
import { BaseTool } from './BaseTool';
import type { CursorSpec, DraftShape, ToolContext, ToolCursorState } from './types';

interface PatchState {
  phase: 'select' | 'position' | 'idle';
  sourceRect: { x: number; y: number; w: number; h: number } | null;
}

export class PatchTool extends BaseTool {
  id = 'patch' as const;

  private patchState: PatchState = { phase: 'idle', sourceRect: null };

  override cursor(state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onActivate(_ctx: ToolContext): void {
    this.patchState = { phase: 'idle', sourceRect: null };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): { consumed: boolean; captured?: boolean } {
    const canvas = ctx.canvasElement;
    if (!canvas) return { consumed: false };

    const world = ctx.canvasToWorld(e.clientX, e.clientY);

    if (this.patchState.phase === 'idle') {
      ctx.setPointerCapture(e.pointerId);
      ctx.beginTransaction();
      this.drag = {
        kind: 'dragging',
        pointerId: e.pointerId,
        startCanvas: { x: e.clientX, y: e.clientY },
        startWorld: world,
        currentCanvas: { x: e.clientX, y: e.clientY },
        currentWorld: world,
      };
      return { consumed: true, captured: true };
    }

    if (this.patchState.phase === 'position' && this.patchState.sourceRect) {
      this.applyPatch(world, canvas, ctx);
      this.patchState = { phase: 'idle', sourceRect: null };
      ctx.setDraft(null);
      ctx.commitTransaction();
      return { consumed: true };
    }

    return { consumed: false };
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.patchState.phase !== 'idle') return;
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({
      kind: 'rect',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      label: `Source ${Math.round(rect.w)} x ${Math.round(rect.h)}`,
    });
  }

  override onDragEnd(ctx: ToolContext): void {
    if (this.patchState.phase !== 'idle') return;
    const rect = this.computeDragRect(ctx);
    if (rect.w < 4 || rect.h < 4) {
      ctx.abortTransaction();
      ctx.setDraft(null);
      return;
    }
    this.patchState = { phase: 'position', sourceRect: rect };
    ctx.announce('Source region selected. Click to position the patch.');
  }

  override onDragCancel(ctx: ToolContext): void {
    if (this.patchState.phase === 'idle') {
      ctx.abortTransaction();
      ctx.setDraft(null);
    }
    this.patchState = { phase: 'idle', sourceRect: null };
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape' && this.patchState.phase === 'position') {
      this.patchState = { phase: 'idle', sourceRect: null };
      ctx.setDraft(null);
      ctx.abortTransaction();
      return true;
    }
    return false;
  }

  private applyPatch(
    targetWorld: { x: number; y: number },
    canvas: HTMLCanvasElement,
    ctx: ToolContext,
  ): void {
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx || !this.patchState.sourceRect) return;

    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const imageData = canvasCtx.getImageData(0, 0, canvasW, canvasH);

    const targetRect = {
      x: Math.round(targetWorld.x - this.patchState.sourceRect.w / 2),
      y: Math.round(targetWorld.y - this.patchState.sourceRect.h / 2),
      w: this.patchState.sourceRect.w,
      h: this.patchState.sourceRect.h,
    };

    const result = patchRegion(imageData, this.patchState.sourceRect, targetRect);
    canvasCtx.putImageData(result, 0, 0);
    ctx.announce('Patch applied');
  }
}
