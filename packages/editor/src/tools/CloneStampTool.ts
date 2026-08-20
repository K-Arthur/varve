/**
 * CloneStampTool — brush-based pixel cloning from a user-defined source point.
 *
 * Alt/Option+click sets the source. Painting then copies pixels from a fixed
 * offset (non-aligned) or from a source that tracks the cursor (aligned).
 *
 * Cloning mutates canonical raster tiles through the shared retouch
 * compositor, so it participates in undo, persistence, export and selection
 * clipping exactly like the brush does — an earlier version drew straight onto
 * the visible canvas, which looked right until the next redraw and never
 * reached the saved document.
 */
import type { AreaSelection } from '@varve/engine';
import type { BrushDab, RasterLayerNode, RasterTile } from '@varve/scene';
import {
  compositeCloneDabOnNode,
  defaultBrushPreset,
  generateDabs,
  snapshotTiles,
  strokePoint,
} from '@varve/scene';
import { BaseTool } from './BaseTool';
import { createRasterTarget, findEditableRasterLayer, rasterLocalPoint } from './rasterTarget';
import { selectionCoverageForDab } from './selectionCoverage';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export interface CloneStampOptions {
  brushSize: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  aligned: boolean;
}

interface CloneSession {
  rasterNodeId: string;
  /** Frozen at stroke start so the stroke cannot sample its own output. */
  sourceTiles: Map<string, RasterTile>;
  /** Source pixel for target (x, y) is (x - offsetX, y - offsetY). */
  offsetX: number;
  offsetY: number;
  areaSelection: AreaSelection | null;
  points: import('@varve/scene').StrokePoint[];
  transactionOpen: boolean;
}

export class CloneStampTool extends BaseTool {
  id = 'cloneStamp' as const;

  /** Source point in layer-local pixels of the layer it was picked on. */
  private sourcePoint: { nodeId: string; x: number; y: number } | null = null;
  private session: CloneSession | null = null;
  private options: CloneStampOptions = {
    brushSize: 40,
    hardness: 0.8,
    opacity: 1,
    flow: 1,
    spacing: 0.15,
    aligned: true,
  };

  setOptions(opts: Partial<CloneStampOptions>): void {
    Object.assign(this.options, opts);
  }

  getOptions(): Readonly<CloneStampOptions> {
    return { ...this.options };
  }

  /** Source marker for the canvas overlay, in layer-local pixels. */
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
    // The source marker is tool UI, not artwork; it must not outlive the tool.
    this.sourcePoint = null;
    ctx.setDraft(null);
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const rasterNodeId = findEditableRasterLayer(ctx) ?? this.createTarget(ctx, e);
    if (!rasterNodeId) return { consumed: false };
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, rasterNodeId, world);

    if (e.altKey) {
      this.sourcePoint = { nodeId: rasterNodeId, x: local.x, y: local.y };
      ctx.announce('Clone source set');
      return { consumed: true };
    }
    if (!this.sourcePoint) {
      ctx.announce('Alt-click to set the clone source first');
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
      // Aligned mode locks the source-to-cursor offset at stroke start and
      // keeps it for the whole stroke; non-aligned restarts from the source
      // point on every stroke.
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
    if (this.options.aligned && this.sourcePoint) {
      // Aligned mode carries the offset forward: the next stroke continues
      // from where this one left off rather than snapping back.
      const last = session.points[session.points.length - 1];
      if (last) {
        this.sourcePoint = {
          nodeId: this.sourcePoint.nodeId,
          x: last.x - session.offsetX,
          y: last.y - session.offsetY,
        };
      }
    }
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

  private createTarget(ctx: ToolContext, e: PointerEvent): string | null {
    return createRasterTarget(ctx, ctx.canvasToWorld(e.clientX, e.clientY));
  }

  /** Generate dabs for the newly sampled segment and clone them in. */
  private stamp(ctx: ToolContext): void {
    const session = this.session;
    if (!session) return;
    const preset = {
      ...defaultBrushPreset('clone', 'Clone'),
      radius: Math.max(0.5, this.options.brushSize / 2),
      hardness: this.options.hardness,
      opacity: this.options.opacity,
      flow: this.options.flow,
      spacing: this.options.spacing,
      smoothing: 0,
    };
    const dabs = generateDabs(session.points, preset);
    if (dabs.length === 0) return;
    // Keep the last point so the next segment starts where this one ended.
    session.points = [session.points[session.points.length - 1]!];

    this.applyDabs(ctx, session, dabs);
  }

  private applyDabs(ctx: ToolContext, session: CloneSession, dabs: BrushDab[]): void {
    ctx.updateNode(session.rasterNodeId, (node) => {
      let updated = node as RasterLayerNode;
      for (const dab of dabs) {
        const coverage = selectionCoverageForDab(
          ctx,
          session.rasterNodeId,
          dab,
          session.areaSelection,
        );
        updated = compositeCloneDabOnNode(updated, dab, {
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
