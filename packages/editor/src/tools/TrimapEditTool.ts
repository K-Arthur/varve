/**
 * TrimapEditTool — three-zone trimap painting for difficult edges.
 *
 * Modes: Foreground (255), Unknown (128), Background (0).
 * Ephemeral trimap lives in editor state until applied via matting.
 *
 * Uses imageMaskCoordinates.ts for transform-aware world-to-source pixel
 * mapping so painting on rotated/scaled/flipped images maps correctly.
 *
 * Research basis: Levin closed-form matting trimap; Photoshop Select & Mask.
 */
import { createBrushMask, TRIMap } from '@strata/engine';
import type { ShapeNode } from '@strata/scene';
import { getOwnRasterMaskAsset, isImageShape, resolveNodePaints } from '@strata/scene';
import { BaseTool } from './BaseTool';
import { prepareImageMaskMapper } from './imageMaskCoordinates';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export type TrimapPenMode = 'foreground' | 'unknown' | 'background';

interface TrimapEditOptions {
  brushSize: number;
  hardness: number;
  penMode: TrimapPenMode;
}

interface MapperState {
  mapWorldPoint: (p: { x: number; y: number }) => { x: number; y: number } | null;
}

function penValue(mode: TrimapPenMode): number {
  switch (mode) {
    case 'foreground':
      return TRIMap.FG;
    case 'unknown':
      return TRIMap.UNKNOWN;
    case 'background':
      return TRIMap.BG;
  }
}

export class TrimapEditTool extends BaseTool {
  id = 'trimapEdit' as const;

  private options: TrimapEditOptions = {
    brushSize: 20,
    hardness: 0.8,
    penMode: 'unknown',
  };
  private brushMask: Uint8Array | null = null;
  private trimap: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private nodeId: string | null = null;
  private lastPaintedPoint: { x: number; y: number } | null = null;
  private mapper: MapperState | null = null;

  override onActivate(ctx: ToolContext): void {
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
    this.initTrimap(ctx);
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.trimap = null;
    this.nodeId = null;
    this.lastPaintedPoint = null;
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
    if (e.key === '1') {
      this.setOptions({ penMode: 'foreground' });
      ctx.announce('Trimap: foreground pen');
      return true;
    }
    if (e.key === '2') {
      this.setOptions({ penMode: 'unknown' });
      ctx.announce('Trimap: unknown pen');
      return true;
    }
    if (e.key === '3') {
      this.setOptions({ penMode: 'background' });
      ctx.announce('Trimap: background pen');
      return true;
    }
    if (e.key === '[' && !e.shiftKey) {
      this.setOptions({ brushSize: Math.max(4, this.options.brushSize - 4) });
      return true;
    }
    if (e.key === ']' && !e.shiftKey) {
      this.setOptions({ brushSize: Math.min(200, this.options.brushSize + 4) });
      return true;
    }
    return false;
  }

  override onPointerDown(
    e: PointerEvent,
    ctx: ToolContext,
  ): { consumed: boolean; captured?: boolean } {
    if (!this.trimap || !this.nodeId) {
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
    this.paintStroke(world, e.pressure);
    return { consumed: true, captured: true };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    this.drag.currentCanvas = canvas;
    this.drag.currentWorld = world;

    if (!this.lastPaintedPoint || !this.trimap) return;

    const coalesced = this.getCoalescedStrokes(e, ctx);
    for (const stroke of coalesced) {
      const dx = stroke.world.x - this.lastPaintedPoint.x;
      const dy = stroke.world.y - this.lastPaintedPoint.y;
      if (Math.sqrt(dx * dx + dy * dy) < Math.max(1, this.options.brushSize * 0.3)) continue;
      this.paintStroke(stroke.world, stroke.pressure);
      this.lastPaintedPoint = stroke.world;
      ctx.setTrimapPreview?.(this.trimap, this.width, this.height);
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    if (this.trimap) {
      ctx.setTrimapPreview?.(this.trimap, this.width, this.height);
      ctx.commitTrimapEdit?.(this.trimap);
    }
    ctx.commitTransaction();
    this.lastPaintedPoint = null;
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.abortTransaction();
    this.lastPaintedPoint = null;
  }

  setOptions(opts: Partial<TrimapEditOptions>): void {
    Object.assign(this.options, opts);
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
  }

  getOptions(): TrimapEditOptions {
    return { ...this.options };
  }

  private initTrimap(ctx: ToolContext): void {
    const selectedId = ctx.selection?.[0];
    if (!selectedId) return;

    const node = ctx.getNode(selectedId) as ShapeNode | undefined;
    if (!node || !isImageShape(node)) return;

    const rasterMask = node.mask?.rasterMask;
    if (!rasterMask?.assetId) return;

    const asset = getOwnRasterMaskAsset(ctx.document, rasterMask.assetId);
    const maskDataUrl = asset?.dataUrl;
    if (!maskDataUrl) return;

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
    this.mapper = prepared ? { mapWorldPoint: prepared.mapWorldPoint } : null;

    const existing = ctx.getTrimapData?.(node.id);
    if (existing) {
      this.trimap = new Uint8Array(existing.data);
      this.width = existing.width;
      this.height = existing.height;
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      ctx2d.drawImage(img, 0, 0);
      const maskData = ctx2d.getImageData(0, 0, img.width, img.height);
      const mask = new Uint8Array(img.width * img.height);
      for (let i = 0; i < mask.length; i++) {
        mask[i] = maskData.data[i * 4] ?? 0;
      }
      import('@strata/engine').then(({ trimapFromMask }) => {
        this.trimap = trimapFromMask(mask, img.width, img.height, 4);
        this.width = img.width;
        this.height = img.height;
        ctx.setTrimapPreview?.(this.trimap, this.width, this.height);
      });
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

  private paintStroke(world: { x: number; y: number }, pressure: number = 0.5): void {
    if (!this.trimap) return;

    const sourcePixel = this.mapper
      ? this.mapper.mapWorldPoint(world)
      : { x: Math.round(world.x), y: Math.round(world.y) };

    if (!sourcePixel) return;

    const value = penValue(this.options.penMode);
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
        if (mx < 0 || mx >= this.width || my < 0 || my >= this.height) continue;
        const weight = this.brushMask ? (this.brushMask[by * d + bx] ?? 0) : 255;
        const scaledWeight = Math.round(weight * opacityScale);
        if (scaledWeight < 32) continue;
        this.trimap[my * this.width + mx] = value;
      }
    }
  }
}
