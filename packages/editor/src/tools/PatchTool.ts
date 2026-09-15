/**
 * PatchTool — region-based correction tool.
 *
 * First drag selects the source region (rectangle). After selection,
 * click to position the patch over the target area. The patch is
 * composited with edge feathering to reduce edge discontinuities.
 *
 * Research basis: Photoshop Patch tool, GIMP Clone tool (perspective).
 */
import type { RasterLayerNode, RasterTile } from '@varve/scene';
import { compositePatchRegionOnNode, snapshotTiles } from '@varve/scene';
import { BaseTool } from './BaseTool';
import { rasterLocalPoint, resolveRetouchTarget } from './rasterTarget';
import { buildRetouchSampleSource, type SamplingScope } from './retouchSampling';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export interface PatchToolOptions {
  featherRadius: number;
  opacity: number;
  samplingScope: SamplingScope;
}

interface PatchState {
  phase: 'select' | 'position' | 'idle';
  sourceRect: { x: number; y: number; w: number; h: number } | null;
  sourceTiles: Map<string, RasterTile> | null;
  rasterNodeId: string | null;
}

export class PatchTool extends BaseTool {
  id = 'patch' as const;

  private options: PatchToolOptions = { featherRadius: 12, opacity: 1, samplingScope: 'current' };

  private patchState: PatchState = {
    phase: 'idle',
    sourceRect: null,
    sourceTiles: null,
    rasterNodeId: null,
  };

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  setOptions(opts: Partial<PatchToolOptions>): void {
    Object.assign(this.options, opts);
  }

  getOptions(): Readonly<PatchToolOptions> {
    return { ...this.options };
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
      const target = resolveRetouchTarget(ctx);
      if (target.kind !== 'raster') {
        ctx.announce(target.reason);
        return { consumed: false };
      }
      const node = ctx.getNode(target.nodeId);
      if (node?.kind !== 'rasterLayer') {
        ctx.announce('Patch could not resolve its raster target');
        return { consumed: false };
      }
      const gesture = super.onPointerDown(e, ctx);
      if (!gesture.consumed) return gesture;
      ctx.beginTransaction();
      this.patchState = {
        phase: 'idle',
        sourceRect: null,
        sourceTiles: this.buildSamplingSource(ctx, node as RasterLayerNode),
        rasterNodeId: target.nodeId,
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

  private applyPatch(targetWorld: { x: number; y: number }, ctx: ToolContext): boolean {
    const { sourceRect, sourceTiles, rasterNodeId } = this.patchState;
    if (!sourceRect || !sourceTiles || !rasterNodeId) return false;
    const targetLocal = rasterLocalPoint(ctx, rasterNodeId, targetWorld);
    const targetRect = {
      x: targetLocal.x - sourceRect.w / 2,
      y: targetLocal.y - sourceRect.h / 2,
      w: sourceRect.w,
      h: sourceRect.h,
    };
    const targetNode = ctx.getNode(rasterNodeId);
    if (targetNode?.kind !== 'rasterLayer') return false;
    const patchOptions = {
      sourceTiles,
      sourceRect,
      targetRect,
      featherRadius: this.options.featherRadius,
      opacity: this.options.opacity,
    };
    // updateNode invokes its updater from React state reconciliation. Decide
    // whether this is a real edit before enqueueing it; otherwise a delayed
    // updater can run after abortTransaction and leave history/announcement
    // state inconsistent with the pixels.
    const preview = compositePatchRegionOnNode(targetNode, patchOptions);
    const changed = preview !== targetNode;
    if (!changed) return false;
    ctx.updateNode(rasterNodeId, (current) => {
      if (current.kind !== 'rasterLayer') return current;
      return compositePatchRegionOnNode(current, patchOptions);
    });
    ctx.announce('Patch applied to the raster layer');
    return true;
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

  private buildSamplingSource(ctx: ToolContext, node: RasterLayerNode): Map<string, RasterTile> {
    if (this.options.samplingScope === 'current') return snapshotTiles(node);
    const result = buildRetouchSampleSource(ctx, node, this.options.samplingScope);
    if (result.truncated) {
      ctx.announce(
        'Merged sampling reached its size budget; some transformed layers were not sampled.',
      );
    }
    return result.tiles;
  }
}
