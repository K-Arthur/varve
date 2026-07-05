/**
 * RefineMaskTool — brush-based mask refinement for background removal masks.
 *
 * Left-click/brush adds to the mask (foreground mode).
 * Alt+click/brush subtracts from the mask (background mode).
 *
 * Research basis: Photoshop Refine Edge brush, GIMP foreground-select tool,
 *                 Canvas 2D ImageData compositing.
 */
import { createBrushMask } from '@strata/engine';
import type { ImageNode, SceneNode } from '@strata/scene';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

interface RefineMaskOptions {
  brushSize: number;
  hardness: number;
}

export class RefineMaskTool extends BaseTool {
  id = 'refineMask' as const;

  private options: RefineMaskOptions = {
    brushSize: 20,
    hardness: 0.8,
  };
  private brushMask: Uint8Array | null = null;
  private maskData: ImageData | null = null;
  private nodeId: string | null = null;
  private lastPaintedPoint: { x: number; y: number } | null = null;
  private pendingLoad: boolean = false;

  override onActivate(ctx: ToolContext): void {
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
    this.loadMask(ctx);
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.maskData = null;
    this.nodeId = null;
    this.lastPaintedPoint = null;
    this.pendingLoad = false;
  }

  override cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'none' };
    return { css: 'crosshair' };
  }

  override onPointerDown(
    e: PointerEvent,
    ctx: ToolContext,
  ): { consumed: boolean; captured?: boolean } {
    if (!this.maskData && !this.pendingLoad) {
      this.loadMask(ctx);
    }
    if (!this.maskData || !this.nodeId) {
      ctx.announce('Select an image with background removal applied first');
      return { consumed: false };
    }

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
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

    this.paintStroke(world, e.altKey, ctx);

    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    if (!this.lastPaintedPoint || !this.maskData) return;

    const world = this.drag.currentWorld;
    const dx = world.x - this.lastPaintedPoint.x;
    const dy = world.y - this.lastPaintedPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = Math.max(1, this.options.brushSize * 0.3);

    if (dist < step) return;

    this.paintStroke(world, ctx.altKey, ctx);
    this.lastPaintedPoint = world;
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    this.commitMask(ctx);
    ctx.commitTransaction();
    this.lastPaintedPoint = null;
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.abortTransaction();
    this.lastPaintedPoint = null;
    this.maskData = null;
    this.nodeId = null;
  }

  setOptions(opts: Partial<RefineMaskOptions>): void {
    Object.assign(this.options, opts);
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
  }

  private loadMask(ctx: ToolContext): void {
    const selectedId = ctx.selection[0];
    if (!selectedId) {
      this.maskData = null;
      this.nodeId = null;
      return;
    }

    const node = ctx.getNode(selectedId) as ImageNode | undefined;
    if (!node || node.kind !== 'image' || !node.backgroundRemoval?.maskDataUrl) {
      this.maskData = null;
      this.nodeId = null;
      return;
    }

    this.nodeId = node.id;
    this.pendingLoad = true;

    const img = new Image();
    img.onload = () => {
      this.pendingLoad = false;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) return;
        ctx2d.drawImage(img, 0, 0);
        this.maskData = ctx2d.getImageData(0, 0, img.width, img.height);
      } catch {
        this.maskData = null;
      }
    };
    img.onerror = () => {
      this.pendingLoad = false;
      this.maskData = null;
    };
    img.src = node.backgroundRemoval.maskDataUrl;
  }

  private paintStroke(world: { x: number; y: number }, subtract: boolean, ctx: ToolContext): void {
    if (!this.maskData) return;

    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;

    const bw = this.options.brushSize;
    const r = Math.floor(bw / 2);
    const tx = Math.round(world.x) - r;
    const ty = Math.round(world.y) - r;
    const d = r * 2 + 1;

    for (let by = 0; by < d; by++) {
      for (let bx = 0; bx < d; bx++) {
        const mx = tx + bx;
        const my = ty + by;
        if (mx < 0 || mx >= this.maskData.width || my < 0 || my >= this.maskData.height) continue;

        const data = this.maskData.data;
        const maskWeight = this.brushMask ? this.brushMask[by * d + bx]! : 255;
        const pixelIdx = (my * this.maskData.width + mx) * 4;

        if (subtract) {
          const newVal = data[pixelIdx]! * (1 - maskWeight / 255);
          const rounded = Math.round(newVal);
          data[pixelIdx] = rounded;
          data[pixelIdx + 1] = rounded;
          data[pixelIdx + 2] = rounded;
          data[pixelIdx + 3] = rounded;
        } else {
          const curVal = data[pixelIdx]!;
          const newVal = curVal + (255 - curVal) * (maskWeight / 255);
          const rounded = Math.round(newVal);
          data[pixelIdx] = rounded;
          data[pixelIdx + 1] = rounded;
          data[pixelIdx + 2] = rounded;
          data[pixelIdx + 3] = rounded;
        }
      }
    }

    this.commitMask(ctx);
  }

  private commitMask(ctx: ToolContext): void {
    if (!this.maskData || !this.nodeId) return;

    const newDataUrl = this.encodeMask(this.maskData);
    if (!newDataUrl) return;

    ctx.updateNode(this.nodeId, (node: SceneNode) => {
      const imgNode = node as ImageNode;
      if (!imgNode.backgroundRemoval) return node;
      return {
        ...imgNode,
        backgroundRemoval: {
          ...imgNode.backgroundRemoval,
          maskDataUrl: newDataUrl,
        },
      } as SceneNode;
    });
  }

  private encodeMask(imageData: ImageData): string | null {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }
}
