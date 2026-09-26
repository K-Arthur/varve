/**
 * DodgeBurnTool — local lightening (dodge) and darkening (burn) brush.
 *
 * One tool with a mode switch rather than two competing brushes: the
 * underlying operation is a signed exposure change applied in linear light
 * under the brush mask, with an optional shadows/midtones/highlights focus.
 * It writes canonical raster tiles through the shared retouch compositor, so
 * strokes participate in undo, persistence, selection clipping and export
 * exactly like clone and heal.
 *
 * Research basis: Photoshop Dodge/Burn tools (range-limited exposure), the
 * darktable shade/raise module (linear-light exposure scaling). Reusing the
 * exposure kernels' mathematics keeps local lightening/darkening consistent
 * with the global Exposure slider instead of inventing a second brightness
 * model.
 */
import type { BrushDab } from '@varve/scene';
import {
  compositeDodgeBurnDabOnNode,
  type DodgeBurnRange,
  defaultBrushPreset,
  generateDabs,
  strokePoint,
} from '@varve/scene';
import { BaseTool } from './BaseTool';
import { pressureForDrawingInput } from './drawingInputRuntime';
import { rasterLocalPoint, resolveRetouchTarget } from './rasterTarget';
import { selectionCoverageForDab } from './selectionCoverage';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

/**
 * Pen pressure scales per-dab flow: the identity bezier maps pressure p to a
 * 2p multiplier, so a mouse's constant 0.5 (and pressure disabled) deposits
 * exactly the unmodified preset flow, while a light pen stroke applies
 * proportionally less and full pressure can reach full strength.
 */
const PRESSURE_FLOW: import('@varve/scene').BrushDynamicsMapping = {
  input: 'pressure',
  target: 'flow',
  curve: [0, 0, 1, 1],
  min: 0,
  max: 2,
};

/**
 * Only a real pen reports meaningful pressure; a mouse reports a constant 0.5
 * while its button is down and synthetic events report 0, which would both
 * silently weaken deposits.
 */
function penPressure(e: PointerEvent): number {
  if (e.pointerType !== 'pen') return 1;
  return pressureForDrawingInput(e.pressure);
}

export interface DodgeBurnOptions {
  brushSize: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  mode: 'dodge' | 'burn';
  /** Exposure strength in stops per full-strength deposit. */
  exposure: number;
  range: DodgeBurnRange;
}

interface DodgeBurnSession {
  rasterNodeId: string;
  areaSelection: import('@varve/engine').AreaSelection | null;
  points: import('@varve/scene').StrokePoint[];
  transactionOpen: boolean;
  /** True once a dab actually changed destination pixels. */
  wrote: boolean;
}

export class DodgeBurnTool extends BaseTool {
  id = 'dodgeBurn' as const;

  private session: DodgeBurnSession | null = null;
  private options: DodgeBurnOptions = {
    brushSize: 40,
    hardness: 0.5,
    opacity: 1,
    flow: 1,
    spacing: 0.15,
    mode: 'dodge',
    exposure: 0.5,
    range: 'midtones',
  };

  setOptions(opts: Partial<DodgeBurnOptions>): void {
    Object.assign(this.options, opts);
  }

  getOptions(): Readonly<DodgeBurnOptions> {
    return { ...this.options };
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
    ctx.setDraft(null);
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    // Dodge/burn modifies existing pixels: a raster target with content is
    // required, and the tool never fabricates an empty layer to brush on.
    const target = resolveRetouchTarget(ctx);
    if (target.kind !== 'raster') {
      ctx.announce(target.reason);
      return { consumed: false };
    }
    const rasterNodeId = target.nodeId;
    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, rasterNodeId, world);
    ctx.beginTransaction();
    this.session = {
      rasterNodeId,
      areaSelection: ctx.areaSelection ?? null,
      points: [strokePoint(local.x, local.y, { pressure: penPressure(e) })],
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
    const local = rasterLocalPoint(ctx, session.rasterNodeId, this.drag.currentWorld);
    session.points.push(strokePoint(local.x, local.y, { pressure: penPressure(e) }));
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
        session.points.push(strokePoint(local.x, local.y, { pressure: penPressure(e) }));
        this.stamp(ctx);
      }
    }
    super.onPointerUp(e, ctx);
    if (!session) return;
    this.session = null;
    if (session.transactionOpen) {
      // A stroke that changed no pixels (empty layer, zero-coverage selection)
      // must not leave a history step.
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

  private stamp(ctx: ToolContext): void {
    const session = this.session;
    if (!session) return;
    const preset = {
      ...defaultBrushPreset('dodge', 'Dodge'),
      radius: Math.max(0.5, this.options.brushSize / 2),
      hardness: this.options.hardness,
      opacity: this.options.opacity,
      flow: this.options.flow,
      spacing: this.options.spacing,
      smoothing: 0,
      dynamics: [PRESSURE_FLOW],
    };
    const dabs = generateDabs(session.points, preset);
    if (dabs.length === 0) return;
    // Keep the last point so the next segment starts where this one ended.
    session.points = [session.points[session.points.length - 1]!];
    this.applyDabs(ctx, session, dabs);
  }

  private applyDabs(ctx: ToolContext, session: DodgeBurnSession, dabs: BrushDab[]): void {
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
        updated = compositeDodgeBurnDabOnNode(updated, dab, {
          mode: this.options.mode,
          exposure: this.options.exposure,
          range: this.options.range,
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
