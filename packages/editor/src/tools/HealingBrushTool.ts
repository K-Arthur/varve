/**
 * HealingBrushTool — copies texture from a source point while taking colour
 * from the destination, so repairs blend into their surroundings.
 *
 * Alt/Option+click sets the source. Like Clone Stamp, healing mutates
 * canonical raster tiles through the shared retouch compositor, so the result
 * is undoable, persisted and clipped by the active selection.
 */
import type { AreaSelection } from '@varve/engine';
import type { BrushDab, RasterLayerNode, RasterTile } from '@varve/scene';
import {
  compositeHealDabOnNode,
  defaultBrushPreset,
  generateDabs,
  snapshotTiles,
  strokePoint,
} from '@varve/scene';
import { BaseTool } from './BaseTool';
import { createRasterTarget, findEditableRasterLayer, rasterLocalPoint } from './rasterTarget';
import { selectionCoverageForDab } from './selectionCoverage';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export interface HealingBrushOptions {
  brushSize: number;
  hardness: number;
  opacity: number;
  spacing: number;
}

interface HealSession {
  rasterNodeId: string;
  sourceTiles: Map<string, RasterTile>;
  offsetX: number;
  offsetY: number;
  areaSelection: AreaSelection | null;
  points: import('@varve/scene').StrokePoint[];
  transactionOpen: boolean;
}

export class HealingBrushTool extends BaseTool {
  id = 'healBrush' as const;

  private sourcePoint: { nodeId: string; x: number; y: number } | null = null;
  private session: HealSession | null = null;
  private options: HealingBrushOptions = {
    brushSize: 40,
    hardness: 0.7,
    opacity: 1,
    spacing: 0.15,
  };

  setOptions(opts: Partial<HealingBrushOptions>): void {
    Object.assign(this.options, opts);
  }

  getOptions(): Readonly<HealingBrushOptions> {
    return { ...this.options };
  }

  getSourcePoint(): { nodeId: string; x: number; y: number } | null {
    return this.sourcePoint;
  }

  override cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'none' };
    return { css: 'crosshair' };
  }

  override onActivate(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.session) this.abortStroke(ctx);
    this.sourcePoint = null;
    ctx.setDraft(null);
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const rasterNodeId =
      findEditableRasterLayer(ctx) ??
      createRasterTarget(ctx, ctx.canvasToWorld(e.clientX, e.clientY));
    if (!rasterNodeId) return { consumed: false };
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, rasterNodeId, world);

    if (e.altKey) {
      this.sourcePoint = { nodeId: rasterNodeId, x: local.x, y: local.y };
      ctx.announce('Healing source set');
      return { consumed: true };
    }
    if (!this.sourcePoint) {
      ctx.announce('Alt-click to set the healing source first');
      return { consumed: false };
    }

    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;
    const node = ctx.getNode(rasterNodeId) as RasterLayerNode | undefined;
    if (!node) return { consumed: false };

    ctx.beginTransaction();
    this.session = {
      rasterNodeId,
      sourceTiles: snapshotTiles(node),
      offsetX: local.x - this.sourcePoint.x,
      offsetY: local.y - this.sourcePoint.y,
      areaSelection: ctx.areaSelection ?? null,
      points: [strokePoint(local.x, local.y, { pressure: 1 })],
      transactionOpen: true,
    };
    this.stamp(ctx);
    return result;
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    const session = this.session;
    if (!session) return;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, session.rasterNodeId, this.drag.currentWorld);
    session.points.push(strokePoint(local.x, local.y, { pressure: 1 }));
    this.stamp(ctx);
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    const session = this.session;
    super.onPointerUp(e, ctx);
    if (!session) return;
    this.session = null;
    if (session.transactionOpen) ctx.commitTransaction();
    ctx.setDraft(null);
  }

  override onDragCancel(ctx: ToolContext): void {
    this.abortStroke(ctx);
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape' && this.session) {
      this.abortStroke(ctx);
      return true;
    }
    return false;
  }

  private stamp(ctx: ToolContext): void {
    const session = this.session;
    if (!session) return;
    const preset = {
      ...defaultBrushPreset('heal', 'Heal'),
      radius: Math.max(0.5, this.options.brushSize / 2),
      hardness: this.options.hardness,
      opacity: this.options.opacity,
      flow: 1,
      spacing: this.options.spacing,
      smoothing: 0,
    };
    const dabs = generateDabs(session.points, preset);
    if (dabs.length === 0) return;
    session.points = [session.points[session.points.length - 1]!];
    this.applyDabs(ctx, session, dabs);
  }

  private applyDabs(ctx: ToolContext, session: HealSession, dabs: BrushDab[]): void {
    ctx.updateNode(session.rasterNodeId, (node) => {
      let updated = node as RasterLayerNode;
      for (const dab of dabs) {
        const coverage = selectionCoverageForDab(
          ctx,
          session.rasterNodeId,
          dab,
          session.areaSelection,
        );
        updated = compositeHealDabOnNode(updated, dab, {
          sourceTiles: session.sourceTiles,
          offsetX: session.offsetX,
          offsetY: session.offsetY,
          coverage,
        });
      }
      return updated;
    });
  }

  private abortStroke(ctx: ToolContext): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    if (session.transactionOpen) ctx.abortTransaction();
    ctx.setDraft(null);
  }
}
