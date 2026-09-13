/**
 * PatchTool — region-based correction tool.
 *
 * First drag selects the source region (rectangle). After selection,
 * click to position the patch over the target area. The patch is
 * composited with edge feathering for seamless correction.
 *
 * Research basis: Photoshop Patch tool, GIMP Clone tool (perspective).
 */
import type { RasterLayerNode, RasterTile } from '@varve/scene';
import { compositePatchRegionOnNode, snapshotTiles } from '@varve/scene';
import { BaseTool } from './BaseTool';
import { findEditableRasterLayer, rasterLocalPoint } from './rasterTarget';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

interface PatchState {
  phase: 'select' | 'position' | 'idle';
  sourceRect: { x: number; y: number; w: number; h: number } | null;
  sourceTiles: Map<string, RasterTile> | null;
  rasterNodeId: string | null;
}

export class PatchTool extends BaseTool {
  id = 'patch' as const;

  private patchState: PatchState = {
    phase: 'idle',
    sourceRect: null,
    sourceTiles: null,
    rasterNodeId: null,
  };

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onActivate(_ctx: ToolContext): void {
    this.patchState = this.emptyState();
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.patchState.sourceTiles) ctx.abortTransaction();
    this.patchState = this.emptyState();
    ctx.setDraft(null);
  }

  override onPointerDown(
    e: PointerEvent,
    ctx: ToolContext,
  ): { consumed: boolean; captured?: boolean } {
    const world = ctx.canvasToWorld(e.clientX, e.clientY);

    if (this.patchState.phase === 'idle') {
      const rasterNodeId = findEditableRasterLayer(ctx);
      if (!rasterNodeId) {
        ctx.announce('Patch needs an editable raster layer with source pixels');
        return { consumed: false };
      }
      const node = ctx.getNode(rasterNodeId);
      if (!node || node.kind !== 'rasterLayer') {
        ctx.announce('Patch could not resolve its raster target');
        return { consumed: false };
      }
      const gesture = super.onPointerDown(e, ctx);
      if (!gesture.consumed) return gesture;
      ctx.beginTransaction();
      this.patchState = {
        phase: 'idle',
        sourceRect: null,
        sourceTiles: snapshotTiles(node as RasterLayerNode),
        rasterNodeId,
      };
      return gesture;
    }

    if (this.patchState.phase === 'position' && this.patchState.sourceRect) {
      const changed = this.applyPatch(world, ctx);
      this.patchState = this.emptyState();
      ctx.setDraft(null);
      if (changed) {
        ctx.commitTransaction();
      } else {
        ctx.abortTransaction();
        ctx.announce('Patch had no valid source or destination pixels');
      }
      return { consumed: true };
    }

    return { consumed: false };
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.patchState.phase !== 'idle' || !this.patchState.rasterNodeId) return;
    const rect = this.computeLocalDragRect(ctx, this.patchState.rasterNodeId);
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
    if (this.patchState.phase !== 'idle' || !this.patchState.rasterNodeId) return;
    const rect = this.computeLocalDragRect(ctx, this.patchState.rasterNodeId);
    if (rect.w < 4 || rect.h < 4) {
      ctx.abortTransaction();
      this.patchState = this.emptyState();
      ctx.setDraft(null);
      return;
    }
    this.patchState = { ...this.patchState, phase: 'position', sourceRect: rect };
    ctx.announce('Source region selected. Click to position the patch.');
  }

  override onDragCancel(ctx: ToolContext): void {
    if (this.patchState.sourceTiles) {
      ctx.abortTransaction();
      ctx.setDraft(null);
    }
    this.patchState = this.emptyState();
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape' && this.patchState.sourceTiles) {
      ctx.abortTransaction();
      this.patchState = this.emptyState();
      ctx.setDraft(null);
      return true;
    }
    return false;
  }

  private applyPatch(
    targetWorld: { x: number; y: number },
    ctx: ToolContext,
  ): boolean {
    const { sourceRect, sourceTiles, rasterNodeId } = this.patchState;
    if (!sourceRect || !sourceTiles || !rasterNodeId) return false;
    const targetLocal = rasterLocalPoint(ctx, rasterNodeId, targetWorld);
    const targetRect = {
      x: targetLocal.x - sourceRect.w / 2,
      y: targetLocal.y - sourceRect.h / 2,
      w: sourceRect.w,
      h: sourceRect.h,
    };
    let changed = false;
    ctx.updateNode(rasterNodeId, (current) => {
      if (current.kind !== 'rasterLayer') return current;
      const next = compositePatchRegionOnNode(current, {
        sourceTiles,
        sourceRect,
        targetRect,
      });
      changed = next !== current;
      return next;
    });
    if (changed) ctx.announce('Patch applied to the raster layer');
    return changed;
  }

  private computeLocalDragRect(ctx: ToolContext, rasterNodeId: string) {
    const start = rasterLocalPoint(ctx, rasterNodeId, this.drag.startWorld);
    const current = rasterLocalPoint(ctx, rasterNodeId, this.drag.currentWorld);
    return {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      w: Math.abs(current.x - start.x),
      h: Math.abs(current.y - start.y),
    };
  }

  private emptyState(): PatchState {
    return {
      phase: 'idle',
      sourceRect: null,
      sourceTiles: null,
      rasterNodeId: null,
    };
  }
}
