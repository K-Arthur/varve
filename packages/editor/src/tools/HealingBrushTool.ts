/**
 * HealingBrushTool — paint-based tool that blends source texture with target
 * using NCC (Normalized Cross-Correlation) for best patch matching.
 *
 * Alt+click sets the source point. Painting copies source texture and blends
 * with target content for seamless repair.
 *
 * Research basis: Photoshop Healing Brush, GIMP Heal tool.
 *                 NCC patch matching (Barnes et al. 2009 PatchMatch).
 */
import { createBrushMask, findBestPatch, healPixels } from '@varve/engine';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

interface HealingBrushOptions {
  brushSize: number;
  hardness: number;
  source: 'sampled' | 'pattern';
}

export class HealingBrushTool extends BaseTool {
  id = 'healBrush' as const;

  private sourcePoint: { x: number; y: number } | null = null;
  private options: HealingBrushOptions = {
    brushSize: 20,
    hardness: 0.7,
    source: 'sampled',
  };
  private brushMask: Uint8Array | null = null;
  private lastPaintedPoint: { x: number; y: number } | null = null;

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
      ctx.announce('Healing source point set');
      return { consumed: true };
    }

    if (!this.sourcePoint) {
      ctx.announce('Alt+click to set healing source point first');
      return { consumed: false };
    }

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

    this.healStroke(world, canvas, ctx);
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

    this.healStroke(world, canvas, ctx);
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

  private healStroke(
    _world: { x: number; y: number },
    canvas: HTMLCanvasElement,
    _ctx: ToolContext,
  ): void {
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx || !this.sourcePoint) return;

    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const fullData = canvasCtx.getImageData(0, 0, canvasW, canvasH);
    const r = Math.floor(this.options.brushSize / 2);
    const searchRadius = this.options.brushSize * 4;

    const bestPatch = findBestPatch(
      fullData,
      fullData,
      Math.round(this.sourcePoint.x),
      Math.round(this.sourcePoint.y),
      r,
      Math.round(searchRadius),
    );

    const pw = r * 2 + 1;
    const patchData = new Uint8ClampedArray(pw * pw * 4);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const pi = ((dy + r) * pw + (dx + r)) * 4;
        const sx = bestPatch.x!;
        const sy = bestPatch.y!;
        const si2 = ((sy + dy) * canvasW + (sx + dx)) * 4;
        patchData[pi] = fullData.data[si2]!;
        patchData[pi + 1] = fullData.data[si2 + 1]!;
        patchData[pi + 2] = fullData.data[si2 + 2]!;
        patchData[pi + 3] = fullData.data[si2 + 3]!;
      }
    }

    const patchImageData = new ImageData(patchData, pw, pw);
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;

    const result = healPixels(fullData, patchImageData, this.brushMask);
    canvasCtx.putImageData(result, 0, 0);
  }

  setOptions(opts: Partial<HealingBrushOptions>): void {
    Object.assign(this.options, opts);
  }
}
