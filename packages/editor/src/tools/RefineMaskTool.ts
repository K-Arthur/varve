/**
 * RefineMaskTool — brush-based mask refinement for background removal masks.
 *
 * Left-click/brush adds to the mask (foreground mode).
 * Alt+click/brush subtracts from the mask (background mode).
 *
 * Uses imageMaskCoordinates.ts for transform-aware world-to-source pixel
 * mapping. Pressure sensitivity from PointerEvent.pressure, coalesced
 * events from getCoalescedEvents() for seamless strokes.
 *
 * Research basis: Photoshop Refine Edge brush, GIMP foreground-select tool,
 *                 Canvas 2D ImageData compositing.
 */
import { createBrushMask } from '@varve/engine';
import type { ShapeNode } from '@varve/scene';
import { getOwnRasterMaskAsset, isImageShape, resolveNodePaints } from '@varve/scene';
import { BaseTool } from './BaseTool';
import { prepareImageMaskMapper } from './imageMaskCoordinates';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

interface RefineMaskOptions {
  brushSize: number;
  hardness: number;
}

interface MapperState {
  mapWorldPoint: (p: { x: number; y: number }) => { x: number; y: number } | null;
  sourceWidth: number;
  sourceHeight: number;
}

function cloneImageData(src: ImageData): ImageData {
  const copy = new ImageData(src.width, src.height);
  copy.data.set(src.data);
  return copy;
}

export class RefineMaskTool extends BaseTool {
  id = 'refineMask' as const;

  private options: RefineMaskOptions = {
    brushSize: 20,
    hardness: 0.8,
  };
  private brushMask: Uint8Array | null = null;
  private maskData: ImageData | null = null;
  private maskSnapshot: ImageData | null = null;
  private nodeId: string | null = null;
  private lastPaintedPoint: { x: number; y: number } | null = null;
  private pendingLoad = false;
  private mapper: MapperState | null = null;

  override onActivate(ctx: ToolContext): void {
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
    this.loadMask(ctx);
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.maskData = null;
    this.maskSnapshot = null;
    this.nodeId = null;
    this.lastPaintedPoint = null;
    this.pendingLoad = false;
    this.mapper = null;
  }

  override cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'none' };
    return { css: 'crosshair' };
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape' || e.key === 'v' || e.key === 'V') {
      ctx.setTool('select');
      return true;
    }
    if (e.key === '[' && !e.shiftKey) {
      this.setOptions({ brushSize: Math.max(4, this.options.brushSize - 4) });
      ctx.announce(`Brush size ${this.options.brushSize}`);
      return true;
    }
    if (e.key === ']' && !e.shiftKey) {
      this.setOptions({ brushSize: Math.min(200, this.options.brushSize + 4) });
      ctx.announce(`Brush size ${this.options.brushSize}`);
      return true;
    }
    if (e.key === '[' && e.shiftKey) {
      this.setOptions({ hardness: Math.max(0, this.options.hardness - 0.1) });
      ctx.announce(`Hardness ${Math.round(this.options.hardness * 100)}%`);
      return true;
    }
    if (e.key === ']' && e.shiftKey) {
      this.setOptions({ hardness: Math.min(1, this.options.hardness + 0.1) });
      ctx.announce(`Hardness ${Math.round(this.options.hardness * 100)}%`);
      return true;
    }
    return false;
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

    this.maskSnapshot = cloneImageData(this.maskData);

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

    this.paintStroke(world, e.altKey, e.pressure);

    return { consumed: true, captured: true };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    this.drag.currentCanvas = canvas;
    this.drag.currentWorld = world;

    if (!this.lastPaintedPoint || !this.maskData) return;

    const coalesced = this.getCoalescedStrokes(e, ctx);
    for (const stroke of coalesced) {
      const dx = stroke.world.x - this.lastPaintedPoint.x;
      const dy = stroke.world.y - this.lastPaintedPoint.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = Math.max(1, this.options.brushSize * 0.3);
      if (dist < step) continue;
      this.paintStroke(stroke.world, ctx.altKey, stroke.pressure);
      this.lastPaintedPoint = stroke.world;
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    this.commitMask(ctx);
    ctx.commitTransaction();
    this.maskSnapshot = null;
    this.lastPaintedPoint = null;
  }

  override onDragCancel(ctx: ToolContext): void {
    if (this.maskSnapshot) {
      this.maskData = cloneImageData(this.maskSnapshot);
    }
    this.maskSnapshot = null;
    ctx.abortTransaction();
    this.lastPaintedPoint = null;
  }

  setOptions(opts: Partial<RefineMaskOptions>): void {
    Object.assign(this.options, opts);
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
  }

  private loadMask(ctx: ToolContext): void {
    const selectedId = ctx.selection?.[0];
    if (!selectedId) {
      this.maskData = null;
      this.nodeId = null;
      this.mapper = null;
      return;
    }

    const node = ctx.getNode(selectedId) as ShapeNode | undefined;
    if (!node || !isImageShape(node)) {
      this.maskData = null;
      this.nodeId = null;
      this.mapper = null;
      return;
    }

    const rasterMask = node.mask?.rasterMask;
    if (!rasterMask?.assetId) {
      this.maskData = null;
      this.nodeId = null;
      this.mapper = null;
      return;
    }

    const asset = getOwnRasterMaskAsset(ctx.document, rasterMask.assetId);
    const maskDataUrl = asset?.dataUrl;
    if (!maskDataUrl) {
      this.maskData = null;
      this.nodeId = null;
      this.mapper = null;
      return;
    }

    this.nodeId = node.id;

    const imageFill = resolveNodePaints(
      { paintRefs: node.paintRefs, fills: node.fills, fill: { ...node.fill } },
      ctx.document,
    ).find((fill) => fill.type === 'image')?.image;
    const sourceWidth = imageFill?.imageWidth ?? (node.shape?.kind === 'rect' ? node.shape.w : 256);
    const sourceHeight =
      imageFill?.imageHeight ?? (node.shape?.kind === 'rect' ? node.shape.h : 256);

    const prepared = prepareImageMaskMapper({
      document: ctx.document,
      node,
      sourceWidth,
      sourceHeight,
    });
    this.mapper = prepared
      ? { mapWorldPoint: prepared.mapWorldPoint, sourceWidth, sourceHeight }
      : null;

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
    img.src = maskDataUrl;
  }

  private getCoalescedStrokes(
    e: PointerEvent,
    ctx: ToolContext,
  ): Array<{ world: { x: number; y: number }; pressure: number }> {
    const strokes: Array<{ world: { x: number; y: number }; pressure: number }> = [];

    if (typeof e.getCoalescedEvents === 'function') {
      const coalesced = e.getCoalescedEvents();
      if (coalesced.length > 0) {
        for (const ce of coalesced) {
          const w = ctx.canvasToWorld(ce.clientX, ce.clientY);
          strokes.push({ world: w, pressure: ce.pressure });
        }
        return strokes;
      }
    }

    strokes.push({ world: this.drag.currentWorld, pressure: e.pressure });
    return strokes;
  }

  private paintStroke(
    world: { x: number; y: number },
    subtract: boolean,
    pressure: number = 0.5,
  ): void {
    if (!this.maskData) return;

    const sourcePixel = this.mapper
      ? this.mapper.mapWorldPoint(world)
      : { x: Math.round(world.x), y: Math.round(world.y) };

    if (!sourcePixel) return;

    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;

    const bw = this.options.brushSize;
    const r = Math.floor(bw / 2);
    const tx = Math.round(sourcePixel.x) - r;
    const ty = Math.round(sourcePixel.y) - r;
    const d = r * 2 + 1;

    const opacityScale = Math.max(0, Math.min(1, pressure));

    for (let by = 0; by < d; by++) {
      for (let bx = 0; bx < d; bx++) {
        const mx = tx + bx;
        const my = ty + by;
        if (mx < 0 || mx >= this.maskData.width || my < 0 || my >= this.maskData.height) continue;

        const data = this.maskData.data;
        const maskWeight = this.brushMask ? this.brushMask[by * d + bx]! : 255;
        const scaledWeight = Math.round(maskWeight * opacityScale);
        if (scaledWeight === 0) continue;
        const pixelIdx = (my * this.maskData.width + mx) * 4;

        if (subtract) {
          const newVal = data[pixelIdx]! * (1 - scaledWeight / 255);
          const rounded = Math.round(newVal);
          data[pixelIdx] = rounded;
          data[pixelIdx + 1] = rounded;
          data[pixelIdx + 2] = rounded;
          data[pixelIdx + 3] = rounded;
        } else {
          const curVal = data[pixelIdx]!;
          const newVal = curVal + (255 - curVal) * (scaledWeight / 255);
          const rounded = Math.round(newVal);
          data[pixelIdx] = rounded;
          data[pixelIdx + 1] = rounded;
          data[pixelIdx + 2] = rounded;
          data[pixelIdx + 3] = rounded;
        }
      }
    }
  }

  private commitMask(ctx: ToolContext): void {
    if (!this.maskData || !this.nodeId) return;

    const newDataUrl = this.encodeMask(this.maskData);
    if (!newDataUrl) return;

    ctx.commitRasterMask?.(this.nodeId, newDataUrl, this.maskData.width, this.maskData.height);
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
