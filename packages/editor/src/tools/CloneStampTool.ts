/**
 * CloneStampTool — brush-based pixel cloning from a user-defined source point.
 *
 * Alt+click sets the source point. Brush paints from source to target while
 * maintaining a relative offset (aligned mode) or fixed offset (non-aligned).
 *
 * Research basis: Photoshop Clone Stamp tool, GIMP Clone tool.
 */
import { clonePixels, createBrushMask } from '@varve/engine';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

interface CloneStampOptions {
  brushSize: number;
  hardness: number;
  opacity: number;
  blendMode: string;
  aligned: boolean;
  sampleAllLayers: boolean;
}

export class CloneStampTool extends BaseTool {
  id = 'cloneStamp' as const;

  private sourcePoint: { x: number; y: number } | null = null;
  private options: CloneStampOptions = {
    brushSize: 20,
    hardness: 0.8,
    opacity: 1,
    blendMode: 'normal',
    aligned: true,
    sampleAllLayers: true,
  };
  private brushMask: Uint8Array | null = null;
  private lastPaintedPoint: { x: number; y: number } | null = null;
  private sourceBase: { x: number; y: number } | null = null;
  private targetBase: { x: number; y: number } | null = null;

  override onActivate(_ctx: ToolContext): void {
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
  }

  override cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'none' };
    return { css: 'crosshair' };
  }

  override onPointerDown(
    e: PointerEvent,
    ctx: ToolContext,
  ): { consumed: boolean; captured?: boolean } {
    const canvas = ctx.canvasElement;
    if (!canvas) return { consumed: false };

    const world = ctx.canvasToWorld(e.clientX, e.clientY);

    if (e.altKey) {
      this.sourcePoint = world;
      ctx.announce('Source point set');
      return { consumed: true };
    }

    if (!this.sourcePoint) {
      ctx.announce('Alt+click to set source point first');
      return { consumed: false };
    }

    this.sourceBase = this.sourcePoint;
    this.targetBase = world;
    this.lastPaintedPoint = world;

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

    this.paintStroke(world, canvas, ctx);

    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    const canvas = ctx.canvasElement;
    if (!canvas || !this.lastPaintedPoint) return;

    const world = this.drag.currentWorld;
    const dx = world.x - this.lastPaintedPoint.x;
    const dy = world.y - this.lastPaintedPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = Math.max(1, this.options.brushSize * 0.3);

    if (dist < step) return;

    this.paintStroke(world, canvas, ctx);
    this.lastPaintedPoint = world;
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    ctx.commitTransaction();
    this.lastPaintedPoint = null;
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.abortTransaction();
    this.lastPaintedPoint = null;
  }

  private paintStroke(
    world: { x: number; y: number },
    canvas: HTMLCanvasElement,
    _ctx: ToolContext,
  ): void {
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;
    if (!this.sourceBase || !this.targetBase) return;

    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;

    let sourceX: number;
    let sourceY: number;
    if (this.options.aligned) {
      const offsetX = world.x - this.targetBase.x;
      const offsetY = world.y - this.targetBase.y;
      sourceX = this.sourceBase.x + offsetX;
      sourceY = this.sourceBase.y + offsetY;
    } else {
      sourceX = this.sourcePoint?.x ?? 0;
      sourceY = this.sourcePoint?.y ?? 0;
    }

    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const targetData = canvasCtx.getImageData(0, 0, canvasW, canvasH);
    const sourceData = targetData;

    const tx = Math.round(world.x);
    const ty = Math.round(world.y);
    const sx = Math.round(sourceX);
    const sy = Math.round(sourceY);

    const result = clonePixels(
      targetData,
      sourceData,
      tx,
      ty,
      sx,
      sy,
      this.options.brushSize,
      this.brushMask,
    );

    canvasCtx.putImageData(result, 0, 0);
  }

  setOptions(opts: Partial<CloneStampOptions>): void {
    Object.assign(this.options, opts);
  }
}
