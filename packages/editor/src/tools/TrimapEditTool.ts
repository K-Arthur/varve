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
import { createBrushMask, TRIMap } from '@varve/engine';
import type { SceneNode, ShapeNode } from '@varve/scene';
import { getOwnRasterMaskAsset, isImageShape, resolveNodePaints } from '@varve/scene';
import { BaseTool } from './BaseTool';
import { effectivePressure, interpolateStrokeSegment } from './brushStroke';
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

/** Extract mask coverage from the alpha channel of a decoded RGBA mask. */
export function rasterMaskAlphaPlane(imageData: ImageData): Uint8Array {
  const mask = new Uint8Array(imageData.width * imageData.height);
  for (let i = 0; i < mask.length; i++) mask[i] = imageData.data[i * 4 + 3] ?? 0;
  return mask;
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
  private targetNode: SceneNode | null = null;
  private initGeneration = 0;
  private lastPaintedSource: { x: number; y: number } | null = null;
  private trimapSnapshot: Uint8Array | null = null;
  private strokeDirty = false;
  private mapper: MapperState | null = null;

  override onActivate(ctx: ToolContext): void {
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
    this.initTrimap(ctx);
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.initGeneration += 1;
    this.trimap = null;
    this.nodeId = null;
    this.targetNode = null;
    this.lastPaintedSource = null;
    this.trimapSnapshot = null;
    this.strokeDirty = false;
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
    if (!this.targetStillValid(ctx)) {
      ctx.announce('Trimap target changed; start a new stroke');
      return { consumed: false };
    }

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const source = this.mapWorldToSource(world);
    this.lastPaintedSource = source;
    this.trimapSnapshot = new Uint8Array(this.trimap);
    this.strokeDirty = false;
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
    if (source) this.paintSourcePoint(source, effectivePressure(e));
    return { consumed: true, captured: true };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    if (!this.targetStillValid(ctx)) {
      this.abortInvalidStroke(ctx, e.pointerId);
      return;
    }
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    this.drag.currentCanvas = canvas;
    this.drag.currentWorld = world;

    if (!this.trimap) return;

    const spacing = Math.max(1, this.options.brushSize * 0.3);
    const coalesced = this.getCoalescedStrokes(e, ctx);
    for (const stroke of coalesced) {
      const pressure = effectivePressure(stroke.event);
      const source = this.mapWorldToSource(stroke.world);
      if (!source) {
        // The pointer left the image; do not interpolate across the gap.
        this.lastPaintedSource = null;
        continue;
      }
      if (!this.lastPaintedSource) {
        // A gesture may start outside the visible image.
        this.paintSourceSample(source, pressure);
      } else {
        this.paintSourceSample(source, pressure, spacing);
      }
      ctx.setTrimapPreview?.(
        this.trimap,
        this.width,
        this.height,
        this.nodeId ?? undefined,
        this.targetNode ?? undefined,
      );
    }
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    this.paintFinalPointer(e, ctx);
    super.onPointerUp(e, ctx);
  }

  override onDragEnd(ctx: ToolContext): void {
    if (!this.trimap || !this.targetStillValid(ctx)) {
      this.abortInvalidStroke(ctx);
      return;
    }
    if (this.strokeDirty) {
      ctx.setTrimapPreview?.(
        this.trimap,
        this.width,
        this.height,
        this.nodeId ?? undefined,
        this.targetNode ?? undefined,
      );
      ctx.commitTrimapEdit?.(this.trimap, this.nodeId ?? undefined, this.targetNode ?? undefined);
      ctx.commitTransaction();
    } else {
      ctx.abortTransaction();
    }
    this.lastPaintedSource = null;
    this.trimapSnapshot = null;
    this.strokeDirty = false;
  }

  override onDragCancel(ctx: ToolContext): void {
    if (this.trimapSnapshot && this.trimap) {
      this.trimap.set(this.trimapSnapshot);
      ctx.setTrimapPreview?.(
        this.trimap,
        this.width,
        this.height,
        this.nodeId ?? undefined,
        this.targetNode ?? undefined,
      );
    }
    ctx.abortTransaction();
    this.lastPaintedSource = null;
    this.trimapSnapshot = null;
    this.strokeDirty = false;
  }

  setOptions(opts: Partial<TrimapEditOptions>): void {
    Object.assign(this.options, opts);
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
  }

  getOptions(): TrimapEditOptions {
    return { ...this.options };
  }

  private initTrimap(ctx: ToolContext): void {
    const generation = ++this.initGeneration;
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
    this.targetNode = node;

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
      if (generation !== this.initGeneration || this.nodeId !== node.id || this.targetNode !== node)
        return;
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      ctx2d.drawImage(img, 0, 0);
      const maskData = ctx2d.getImageData(0, 0, img.width, img.height);
      // RasterMaskAsset encodes coverage in alpha; RGB is intentionally white
      // so a partially transparent mask must not become foreground.
      const mask = rasterMaskAlphaPlane(maskData);
      import('@varve/engine').then(({ trimapFromMask }) => {
        if (
          generation !== this.initGeneration ||
          this.nodeId !== node.id ||
          this.targetNode !== node
        )
          return;
        this.trimap = trimapFromMask(mask, img.width, img.height, 4);
        this.width = img.width;
        this.height = img.height;
        ctx.setTrimapPreview?.(
          this.trimap,
          this.width,
          this.height,
          this.nodeId ?? undefined,
          this.targetNode ?? undefined,
        );
      });
    };
    img.src = maskDataUrl;
  }

  private getCoalescedStrokes(
    e: PointerEvent,
    ctx: ToolContext,
  ): Array<{
    world: { x: number; y: number };
    event: { pressure?: number; pointerType?: string };
  }> {
    const strokes: Array<{
      world: { x: number; y: number };
      event: { pressure?: number; pointerType?: string };
    }> = [];

    if (typeof e.getCoalescedEvents === 'function') {
      const coalesced = e.getCoalescedEvents();
      if (coalesced.length > 0) {
        for (const ce of coalesced) {
          const w = ctx.canvasToWorld(ce.clientX, ce.clientY);
          strokes.push({ world: w, event: ce });
        }
        return strokes;
      }
    }

    strokes.push({ world: this.drag.currentWorld, event: e });
    return strokes;
  }

  private mapWorldToSource(world: { x: number; y: number }): { x: number; y: number } | null {
    return this.mapper
      ? this.mapper.mapWorldPoint(world)
      : { x: Math.round(world.x), y: Math.round(world.y) };
  }

  private targetStillValid(ctx: ToolContext): boolean {
    if (!this.nodeId || !ctx.selection?.includes(this.nodeId)) return false;
    const current = ctx.getNode(this.nodeId);
    return Boolean(current && (!this.targetNode || current === this.targetNode));
  }

  private abortInvalidStroke(ctx: ToolContext, pointerId?: number): void {
    if (this.trimapSnapshot && this.trimap) this.trimap.set(this.trimapSnapshot);
    if (pointerId !== undefined) ctx.releasePointerCapture(pointerId);
    if (this.trimap) {
      ctx.setTrimapPreview?.(
        this.trimap,
        this.width,
        this.height,
        this.nodeId ?? undefined,
        this.targetNode ?? undefined,
      );
    }
    ctx.abortTransaction();
    this.lastPaintedSource = null;
    this.trimapSnapshot = null;
    this.strokeDirty = false;
    this.drag = {
      kind: 'idle',
      pointerId: -1,
      startCanvas: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
      currentCanvas: { x: 0, y: 0 },
      currentWorld: { x: 0, y: 0 },
    };
    ctx.announce('Trimap target changed; stroke cancelled');
  }

  private paintSourceSample(
    source: { x: number; y: number },
    pressure: number,
    spacing = Math.max(1, this.options.brushSize * 0.3),
  ): void {
    if (!this.lastPaintedSource) {
      this.paintSourcePoint(source, pressure);
    } else if (
      Math.hypot(source.x - this.lastPaintedSource.x, source.y - this.lastPaintedSource.y) > 1e-6
    ) {
      for (const point of interpolateStrokeSegment(this.lastPaintedSource, source, spacing)) {
        this.paintSourcePoint(point, pressure);
      }
    }
    this.lastPaintedSource = source;
  }

  private paintFinalPointer(e: PointerEvent, ctx: ToolContext): void {
    if (!this.trimap || !this.targetStillValid(ctx)) {
      this.abortInvalidStroke(ctx, e.pointerId);
      return;
    }
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    this.drag.currentCanvas = canvas;
    this.drag.currentWorld = world;
    const source = this.mapWorldToSource(world);
    if (!source) {
      this.lastPaintedSource = null;
      return;
    }
    this.paintSourceSample(source, effectivePressure(e));
    ctx.setTrimapPreview?.(
      this.trimap,
      this.width,
      this.height,
      this.nodeId ?? undefined,
      this.targetNode ?? undefined,
    );
  }

  /** Paint one categorical dab at a source/mask pixel position. */
  private paintSourcePoint(sourcePixel: { x: number; y: number }, pressure: number): void {
    if (!this.trimap) return;
    if (!Number.isFinite(sourcePixel.x) || !Number.isFinite(sourcePixel.y)) return;
    if (!this.brushMask) {
      this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
    }

    const value = penValue(this.options.penMode);
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
        const index = my * this.width + mx;
        if (this.trimap[index] === value) continue;
        this.trimap[index] = value;
        this.strokeDirty = true;
      }
    }
  }
}
