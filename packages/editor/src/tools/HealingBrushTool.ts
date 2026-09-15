/**
 * HealingBrushTool — copies texture from a source point while taking colour
 * from the destination, so repairs blend into their surroundings.
 *
 * Alt/Option+click sets the source. Like Clone Stamp, healing mutates
 * canonical raster tiles through the shared retouch compositor, so the result
 * is undoable, persisted and clipped by the active selection.
 *
 * Destination ownership is explicit: a selected raster layer is healed, a
 * selected non-raster object is refused with a reason, and the tool never
 * fabricates an empty layer to paint into. See {@link resolveRetouchTarget}.
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
import { rasterLocalPoint, resolveRetouchTarget, sourcePointInLayerSpace } from './rasterTarget';
import { patchRetouchOverlay, resetRetouchOverlay } from './retouchOverlayState';
import { buildRetouchSampleSource, type SamplingScope } from './retouchSampling';
import { selectionCoverageForDab } from './selectionCoverage';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export interface HealingBrushOptions {
  brushSize: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  /**
   * Sampling scope for the frozen stroke-start source.
   *
   * Healing deposits onto the active destination layer only; sampling several
   * layers never bakes them into one.
   */
  samplingScope: SamplingScope;
}

interface HealSession {
  rasterNodeId: string;
  sourceTiles: Map<string, RasterTile>;
  offsetX: number;
  offsetY: number;
  areaSelection: AreaSelection | null;
  points: import('@varve/scene').StrokePoint[];
  transactionOpen: boolean;
  /** True once a dab actually changed destination pixels. */
  wrote: boolean;
}

export class HealingBrushTool extends BaseTool {
  id = 'healBrush' as const;

  /** Source anchor in world coordinates; stable across destination changes. */
  private sourceWorld: { x: number; y: number } | null = null;
  /** Cached source in the picked layer's local pixels, for the marker API. */
  private sourcePoint: { nodeId: string; x: number; y: number } | null = null;
  private session: HealSession | null = null;
  private options: HealingBrushOptions = {
    brushSize: 40,
    hardness: 0.7,
    opacity: 1,
    flow: 1,
    spacing: 0.15,
    samplingScope: 'current',
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
    this.sourceWorld = null;
    this.sourcePoint = null;
    resetRetouchOverlay();
    ctx.setDraft(null);
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const target = resolveRetouchTarget(ctx);
    if (target.kind !== 'raster') {
      ctx.announce(target.reason);
      return { consumed: false };
    }
    const rasterNodeId = target.nodeId;
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, rasterNodeId, world);

    if (e.altKey) {
      this.sourceWorld = { x: world.x, y: world.y };
      this.sourcePoint = { nodeId: rasterNodeId, x: local.x, y: local.y };
      patchRetouchOverlay({
        toolId: this.id,
        cloneSourceWorld: { x: world.x, y: world.y },
        cloneCursorWorld: null,
      });
      ctx.announce('Healing source set');
      return { consumed: true };
    }
    if (!this.sourceWorld && !this.sourcePoint) {
      ctx.announce('Alt-click to set the healing source first');
      return { consumed: false };
    }

    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;
    const node = ctx.getNode(rasterNodeId) as RasterLayerNode | undefined;
    if (node?.kind !== 'rasterLayer') return { consumed: false };

    const sourceLocal = this.resolveSourceLocal(ctx, rasterNodeId);
    ctx.beginTransaction();
    this.session = {
      rasterNodeId,
      sourceTiles: this.buildSamplingSource(ctx, node),
      offsetX: local.x - sourceLocal.x,
      offsetY: local.y - sourceLocal.y,
      areaSelection: ctx.areaSelection ?? null,
      points: [strokePoint(local.x, local.y, { pressure: 1 })],
      transactionOpen: true,
      wrote: false,
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
    patchRetouchOverlay({ toolId: this.id, cloneCursorWorld: this.drag.currentWorld });
    const local = rasterLocalPoint(ctx, session.rasterNodeId, this.drag.currentWorld);
    session.points.push(strokePoint(local.x, local.y, { pressure: 1 }));
    this.stamp(ctx);
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    const session = this.session;
    if (session) {
      // Stamp the release position so the tail of a fast stroke is not lost.
      this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
      this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);
      const local = rasterLocalPoint(ctx, session.rasterNodeId, this.drag.currentWorld);
      const last = session.points[session.points.length - 1];
      if (!last || last.x !== local.x || last.y !== local.y) {
        session.points.push(strokePoint(local.x, local.y, { pressure: 1 }));
        this.stamp(ctx);
      }
    }
    super.onPointerUp(e, ctx);
    patchRetouchOverlay({ toolId: this.id, cloneCursorWorld: null });
    if (!session) return;
    this.session = null;
    if (session.transactionOpen) {
      if (session.wrote) ctx.commitTransaction();
      else ctx.abortTransaction();
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

  private resolveSourceLocal(ctx: ToolContext, rasterNodeId: string): { x: number; y: number } {
    if (this.sourceWorld) return rasterLocalPoint(ctx, rasterNodeId, this.sourceWorld);
    if (this.sourcePoint) return sourcePointInLayerSpace(ctx, this.sourcePoint, rasterNodeId);
    return { x: 0, y: 0 };
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

  private stamp(ctx: ToolContext): void {
    const session = this.session;
    if (!session) return;
    const preset = {
      ...defaultBrushPreset('heal', 'Heal'),
      radius: Math.max(0.5, this.options.brushSize / 2),
      hardness: this.options.hardness,
      opacity: this.options.opacity,
      flow: this.options.flow,
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
      if (node.kind !== 'rasterLayer') return node;
      let updated = node;
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
      if (updated !== node) session.wrote = true;
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
