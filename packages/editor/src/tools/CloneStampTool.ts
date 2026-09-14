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
 *
 * Destination ownership is explicit: a selected raster layer is retouched, a
 * selected non-raster object is refused with a reason, and the tool never
 * fabricates an empty layer to paint into. See {@link resolveRetouchTarget}.
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
import { type Affine, applyAffine } from '@varve/shared';
import { BaseTool } from './BaseTool';
import { rasterLocalPoint, resolveRetouchTarget, sourcePointInLayerSpace } from './rasterTarget';
import { patchRetouchOverlay, resetRetouchOverlay } from './retouchOverlayState';
import { buildRetouchSampleSource, type SamplingScope } from './retouchSampling';
import { selectionCoverageForDab } from './selectionCoverage';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

const IDENTITY_AFFINE: Affine = [1, 0, 0, 1, 0, 0];

export interface CloneStampOptions {
  brushSize: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  aligned: boolean;
  /**
   * Sampling scope for the frozen stroke-start source.
   *
   * Deposits always land on the active destination layer, so sampling several
   * layers never bakes them into one. `current` reads the target alone,
   * `below` reads the target plus everything under it in paint order, and
   * `allVisible` reads the active page's visible raster stack.
   */
  samplingScope: SamplingScope;
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
  /** True once a dab actually changed destination pixels. */
  wrote: boolean;
}

export class CloneStampTool extends BaseTool {
  id = 'cloneStamp' as const;

  /**
   * Source anchor in world coordinates. Layer-local coordinates are not
   * stable across a target change; the world anchor is, so a source picked on
   * one layer stays put when another layer becomes the destination.
   */
  private sourceWorld: { x: number; y: number } | null = null;
  private sourceNodeId: string | null = null;
  /** Cached source in the picked layer's local pixels, for the marker API. */
  private sourcePoint: { nodeId: string; x: number; y: number } | null = null;
  private session: CloneSession | null = null;
  private options: CloneStampOptions = {
    brushSize: 40,
    hardness: 0.8,
    opacity: 1,
    flow: 1,
    spacing: 0.15,
    aligned: true,
    samplingScope: 'current',
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
    this.sourceWorld = null;
    this.sourceNodeId = null;
    this.sourcePoint = null;
    resetRetouchOverlay();
    ctx.setDraft(null);
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    // Resolve ownership before any mutation. Creating a layer here would leave
    // empty artwork behind when the interaction turns out to be "set source"
    // or an invalid click.
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
      this.sourceNodeId = rasterNodeId;
      this.sourcePoint = { nodeId: rasterNodeId, x: local.x, y: local.y };
      patchRetouchOverlay({
        toolId: this.id,
        cloneSourceWorld: { x: world.x, y: world.y },
        cloneCursorWorld: null,
      });
      ctx.announce('Clone source set');
      return { consumed: true };
    }
    if (!this.sourceWorld && !this.sourcePoint) {
      ctx.announce('Alt-click to set the clone source first');
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
      // Aligned mode locks the source-to-cursor offset at stroke start and
      // keeps it for the whole stroke; non-aligned restarts from the source
      // point on every stroke.
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
      // Stamp the release position too: a fast stroke can deliver its last
      // pointermove before the tail of the path, and dropping the final
      // position loses the end of the repair.
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
      // A stroke that wrote no pixels (empty source, zero-coverage selection,
      // fully transparent destination) must not leave a history step.
      if (session.wrote) ctx.commitTransaction();
      else ctx.abortTransaction();
    }
    if (this.options.aligned && this.sourcePoint) {
      // Aligned mode carries the offset forward: the next stroke continues
      // from where this one left off rather than snapping back. The new
      // anchor is expressed in world space and re-derived per destination.
      const last = session.points[session.points.length - 1];
      if (last) {
        const localX = last.x - session.offsetX;
        const localY = last.y - session.offsetY;
        const targetTransform = ctx.getWorldTransform?.(session.rasterNodeId) ?? IDENTITY_AFFINE;
        const [worldX, worldY] = applyAffine(targetTransform, [localX, localY]);
        this.sourceWorld = { x: worldX, y: worldY };
        const sourceNodeId = this.sourceNodeId ?? session.rasterNodeId;
        const marker = rasterLocalPoint(ctx, sourceNodeId, { x: worldX, y: worldY });
        this.sourcePoint = { nodeId: sourceNodeId, x: marker.x, y: marker.y };
        patchRetouchOverlay({ toolId: this.id, cloneSourceWorld: { x: worldX, y: worldY } });
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

  /**
   * The source anchor in the destination layer's local space.
   *
   * The world anchor is authoritative. For tool instantiations that seed a
   * local source point directly (tests, restored sessions), fall back to
   * mapping that stored point through the transforms.
   */
  private resolveSourceLocal(ctx: ToolContext, rasterNodeId: string): { x: number; y: number } {
    if (this.sourceWorld) return rasterLocalPoint(ctx, rasterNodeId, this.sourceWorld);
    if (this.sourcePoint) return sourcePointInLayerSpace(ctx, this.sourcePoint, rasterNodeId);
    return { x: 0, y: 0 };
  }

  /** Freeze the declared sampling scope at stroke start. */
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
      if (node.kind !== 'rasterLayer') return node;
      let updated = node;
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
