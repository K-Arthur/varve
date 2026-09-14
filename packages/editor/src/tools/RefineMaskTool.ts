/**
 * RefineMaskTool — brush-based mask refinement for background removal masks.
 *
 * Brush modes: add/reveal, subtract/hide, and restore-original. Alt while
 * dragging always subtracts, so a pen need not leave the canvas. `brushSize`
 * is measured in mask (source-image or container) pixels, preserving the
 * declared source-resolution footprint; the Inspector reports that unit.
 *
 * Clipping strokes to the active area selection is an explicit, default-off
 * option: automatically clipping a refinement brush to the same selection it
 * is trying to grow makes adding missing detail impossible.
 *
 * Uses imageMaskCoordinates.ts for transform-aware world-to-source pixel
 * mapping. Pressure sensitivity from PointerEvent.pressure, coalesced events
 * and segment interpolation from brushStroke.ts.
 *
 * Research basis: Photoshop Refine Edge / Select & Mask brush, GIMP
 * foreground-select tool; Krita-reported limitation of boundary-clipped
 * refinement brushes.
 */
import { type AreaSelection, areaSelectionCoverageAt, createBrushMask } from '@varve/engine';
import type { FrameNode } from '@varve/scene';
import {
  canReceiveRasterMask,
  getOwnRasterMaskAsset,
  isImageShape,
  nodeLocalBounds,
  resolveNodePaints,
} from '@varve/scene';
import { tryInvertAffine } from '@varve/shared';
import { nodeWorldTransform } from '../scene/world';
import { BaseTool } from './BaseTool';
import { effectivePressure, interpolateStrokeSegment } from './brushStroke';
import { prepareImageMaskMapper } from './imageMaskCoordinates';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

/** Container-local masks are capped at 2048px per side (documented). */
const MAX_CONTAINER_MASK_DIMENSION = 2048;

export type RefineBrushMode = 'add' | 'subtract' | 'restore';

interface RefineMaskOptions {
  brushSize: number;
  hardness: number;
  mode: RefineBrushMode;
  clipToSelection: boolean;
}

interface MapperState {
  mapWorldPoint: (p: { x: number; y: number }) => { x: number; y: number } | null;
  mapMaskPixelToWorld?: (p: { x: number; y: number }) => { x: number; y: number } | null;
  sourceWidth: number;
  sourceHeight: number;
}

function cloneImageData(src: ImageData): ImageData {
  const copy = new ImageData(src.width, src.height);
  copy.data.set(src.data);
  return copy;
}

/** Normalize a decoded mask to the editor's grayscale-alpha representation. */
export function normalizeMaskImageData(src: ImageData): ImageData {
  const normalized = cloneImageData(src);
  for (let offset = 0; offset < normalized.data.length; offset += 4) {
    const alpha = normalized.data[offset + 3] ?? 0;
    normalized.data[offset] = alpha;
    normalized.data[offset + 1] = alpha;
    normalized.data[offset + 2] = alpha;
  }
  return normalized;
}

/** A fresh fully-transparent mask — painting reveals, Alt+painting hides. */
function transparentImageData(width: number, height: number): ImageData {
  const data = new ImageData(Math.max(1, width), Math.max(1, height));
  data.data.fill(0);
  return data;
}

export class RefineMaskTool extends BaseTool {
  id = 'refineMask' as const;

  private options: RefineMaskOptions = {
    brushSize: 20,
    hardness: 0.8,
    mode: 'add',
    clipToSelection: false,
  };
  private brushMask: Uint8Array | null = null;
  private maskData: ImageData | null = null;
  private maskSnapshot: ImageData | null = null;
  private nodeId: string | null = null;
  private lastPaintedPoint: { x: number; y: number } | null = null;
  private lastPaintedSource: { x: number; y: number } | null = null;
  private pendingLoad = false;
  private mapper: MapperState | null = null;
  private strokeDirty = false;
  /** Frozen at pointer-down so an external selection change cannot alter a stroke. */
  private strokeAreaSelection: AreaSelection | null = null;
  private coordinateSpace: 'source-image-pixels' | 'container-local-pixels' | 'node-local-pixels' =
    'source-image-pixels';

  override onActivate(ctx: ToolContext): void {
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
    this.loadMask(ctx);
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.resetState();
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
      ctx.announce('Select a visual layer or frame to paint a mask');
      return { consumed: false };
    }

    this.maskSnapshot = cloneImageData(this.maskData);
    this.strokeAreaSelection = ctx.areaSelection ?? null;
    this.strokeDirty = false;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    this.lastPaintedPoint = world;
    const sourcePixel = this.mapWorldToSource(world);
    this.lastPaintedSource = sourcePixel;

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

    const mode = this.resolveMode(e.altKey);
    if (sourcePixel) {
      this.paintSourcePoint(sourcePixel, effectivePressure(e), mode, this.strokeAreaSelection);
    }

    return { consumed: true, captured: true };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    const canvas = { x: e.clientX, y: e.clientY };
    const world = ctx.canvasToWorld(canvas.x, canvas.y);
    this.drag.currentCanvas = canvas;
    this.drag.currentWorld = world;

    if (!this.maskData) return;
    // Legacy/test callers may only have set the world anchor.
    if (!this.lastPaintedSource && this.lastPaintedPoint) {
      this.lastPaintedSource = this.mapWorldToSource(this.lastPaintedPoint);
    }
    if (!this.lastPaintedSource) return;

    const mode = this.resolveMode(e.altKey);
    const coalesced = this.getCoalescedStrokes(e, ctx);
    for (const stroke of coalesced) {
      const source = this.mapWorldToSource(stroke.world);
      if (!source) continue;
      const spacing = Math.max(1, this.options.brushSize * 0.25);
      for (const point of interpolateStrokeSegment(this.lastPaintedSource, source, spacing)) {
        this.paintSourcePoint(
          point,
          effectivePressure(stroke.event),
          mode,
          this.strokeAreaSelection,
        );
      }
      this.lastPaintedSource = source;
      this.lastPaintedPoint = stroke.world;
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    if (this.strokeDirty) {
      this.commitMask(ctx);
      ctx.commitTransaction();
    } else {
      // A stroke that changed no pixel must not create an empty history entry.
      ctx.abortTransaction();
    }
    this.maskSnapshot = null;
    this.lastPaintedPoint = null;
    this.lastPaintedSource = null;
    this.strokeAreaSelection = null;
    this.strokeDirty = false;
  }

  override onDragCancel(ctx: ToolContext): void {
    if (this.maskSnapshot) {
      this.maskData = cloneImageData(this.maskSnapshot);
    }
    this.maskSnapshot = null;
    ctx.abortTransaction();
    this.lastPaintedPoint = null;
    this.lastPaintedSource = null;
    this.strokeAreaSelection = null;
    this.strokeDirty = false;
  }

  setOptions(opts: Partial<RefineMaskOptions>): void {
    if (opts.brushSize !== undefined) this.options.brushSize = opts.brushSize;
    if (opts.hardness !== undefined) this.options.hardness = opts.hardness;
    if (opts.mode !== undefined) this.options.mode = opts.mode;
    if (opts.clipToSelection !== undefined) {
      this.options.clipToSelection = opts.clipToSelection;
    }
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
  }

  getOptions(): RefineMaskOptions {
    return { ...this.options };
  }

  private resolveMode(altKey: boolean): RefineBrushMode {
    return altKey ? 'subtract' : this.options.mode;
  }

  private mapWorldToSource(world: { x: number; y: number }): { x: number; y: number } | null {
    const mapped = this.mapper
      ? this.mapper.mapWorldPoint(world)
      : { x: Math.round(world.x), y: Math.round(world.y) };
    return mapped ?? null;
  }

  private loadMask(ctx: ToolContext): void {
    const selectedId = ctx.selection?.[0];
    if (!selectedId) {
      this.resetState();
      return;
    }

    const node = ctx.getNode(selectedId);
    const depthSourceId = node?.mask?.rasterMask?.depthRecipe?.sourceBinding.nodeId;
    const sourceNode =
      node?.kind === 'adjustment' && depthSourceId ? ctx.getNode(depthSourceId) : node;
    const isDepthAdjustment =
      node?.kind === 'adjustment' &&
      node.mask?.rasterMask?.coordinateSpace === 'source-image-pixels' &&
      Boolean(depthSourceId) &&
      Boolean(sourceNode && isImageShape(sourceNode));
    if (!node) {
      ctx.announce('Select a visual layer or frame to paint a mask');
      this.resetState();
      return;
    }
    if (
      !canReceiveRasterMask(node, node.mask?.rasterMask?.coordinateSpace) ||
      (node.kind === 'adjustment' && !isDepthAdjustment)
    ) {
      ctx.announce('Select a visual layer, frame, or depth-masked adjustment to paint a mask');
      this.resetState();
      return;
    }

    const isFrame = node.kind === 'frame';
    const imageSourceNode =
      sourceNode && sourceNode.kind === 'shape' && isImageShape(sourceNode) ? sourceNode : null;
    const isImage = imageSourceNode !== null;
    const rasterMask = node.mask?.rasterMask;
    const asset = rasterMask?.assetId
      ? getOwnRasterMaskAsset(ctx.document, rasterMask.assetId)
      : undefined;
    const maskDataUrl = asset?.dataUrl;
    this.nodeId = node.id;
    this.coordinateSpace = isFrame
      ? 'container-local-pixels'
      : isImage
        ? 'source-image-pixels'
        : 'node-local-pixels';

    if (isFrame) {
      // Container-local painted mask: mask pixels map 1:1 to the frame's
      // local units, capped for memory safety. Painting creates the mask
      // on demand when none exists.
      const fw = Math.max(1, node.w ?? 256);
      const fh = Math.max(1, node.h ?? 256);
      const maskW = Math.min(MAX_CONTAINER_MASK_DIMENSION, Math.max(1, Math.ceil(fw)));
      const maskH = Math.min(MAX_CONTAINER_MASK_DIMENSION, Math.max(1, Math.ceil(fh)));
      this.mapper = this.makeFrameMapper(ctx, node, maskW, maskH);
      if (maskDataUrl) {
        this.loadAssetIntoMask(maskDataUrl);
      } else {
        this.maskData = transparentImageData(maskW, maskH);
      }
      return;
    }

    if (!imageSourceNode) {
      // A node-local pixel mask follows the target's local paint bounds. This
      // covers true raster layers as well as editable vector/text targets;
      // only the coverage asset is raster, never the source artwork.
      const bounds = nodeLocalBounds(node, ctx.document);
      if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
        ctx.announce('The selected layer has no paint bounds for a mask');
        this.resetState();
        return;
      }
      const maskW = Math.min(MAX_CONTAINER_MASK_DIMENSION, Math.max(1, Math.ceil(bounds.w)));
      const maskH = Math.min(MAX_CONTAINER_MASK_DIMENSION, Math.max(1, Math.ceil(bounds.h)));
      this.mapper = this.makeNodeLocalMapper(ctx, node.id, bounds, maskW, maskH);
      if (maskDataUrl) {
        this.loadAssetIntoMask(maskDataUrl);
      } else {
        this.maskData = transparentImageData(maskW, maskH);
      }
      return;
    }

    const imageFill = resolveNodePaints(
      {
        paintRefs: imageSourceNode.paintRefs,
        fills: imageSourceNode.fills,
        fill: { ...imageSourceNode.fill },
      },
      ctx.document,
    ).find((fill) => fill.type === 'image')?.image;
    const sourceShape = imageSourceNode.shape;
    const sourceWidth =
      imageFill?.imageWidth ?? (sourceShape?.kind === 'rect' ? sourceShape.w : 256);
    const sourceHeight =
      imageFill?.imageHeight ?? (sourceShape?.kind === 'rect' ? sourceShape.h : 256);

    const prepared = prepareImageMaskMapper({
      document: ctx.document,
      node: imageSourceNode,
      sourceWidth,
      sourceHeight,
    });
    this.mapper = prepared
      ? {
          mapWorldPoint: prepared.mapWorldPoint,
          mapMaskPixelToWorld: prepared.mapSourcePixelToWorld,
          sourceWidth,
          sourceHeight,
        }
      : null;

    if (maskDataUrl) {
      this.loadAssetIntoMask(maskDataUrl);
    } else {
      // Paint-to-create: images without a mask start with a fresh
      // transparent mask at source resolution.
      this.maskData = transparentImageData(sourceWidth, sourceHeight);
    }
  }

  /** Container-local world → mask-pixel mapper for frames. */
  private makeFrameMapper(
    ctx: ToolContext,
    node: FrameNode,
    maskWidth: number,
    maskHeight: number,
  ): MapperState | null {
    const world = nodeWorldTransform(ctx.document, node.id);
    const inverse = tryInvertAffine(world);
    if (!inverse) return null;
    const fw = Math.max(1, node.w ?? 1);
    const fh = Math.max(1, node.h ?? 1);
    return {
      mapWorldPoint: (p: { x: number; y: number }) => {
        const lx = inverse[0] * p.x + inverse[2] * p.y + inverse[4];
        const ly = inverse[1] * p.x + inverse[3] * p.y + inverse[5];
        return {
          x: (lx / fw) * maskWidth,
          y: (ly / fh) * maskHeight,
        };
      },
      mapMaskPixelToWorld: (p: { x: number; y: number }) => {
        const local = { x: (p.x / maskWidth) * fw, y: (p.y / maskHeight) * fh };
        const x = world[0] * local.x + world[2] * local.y + world[4];
        const y = world[1] * local.x + world[3] * local.y + world[5];
        return { x, y };
      },
      sourceWidth: maskWidth,
      sourceHeight: maskHeight,
    };
  }

  /** Map a visual leaf's local paint bounds to an editable mask bitmap. */
  private makeNodeLocalMapper(
    ctx: ToolContext,
    nodeId: string,
    bounds: { x: number; y: number; w: number; h: number },
    maskWidth: number,
    maskHeight: number,
  ): MapperState | null {
    const world = nodeWorldTransform(ctx.document, nodeId);
    const inverse = tryInvertAffine(world);
    if (!inverse) return null;
    return {
      mapWorldPoint: (p) => {
        const lx = inverse[0] * p.x + inverse[2] * p.y + inverse[4];
        const ly = inverse[1] * p.x + inverse[3] * p.y + inverse[5];
        return {
          x: ((lx - bounds.x) / bounds.w) * maskWidth,
          y: ((ly - bounds.y) / bounds.h) * maskHeight,
        };
      },
      mapMaskPixelToWorld: (p) => {
        const localX = bounds.x + (p.x / maskWidth) * bounds.w;
        const localY = bounds.y + (p.y / maskHeight) * bounds.h;
        return {
          x: world[0] * localX + world[2] * localY + world[4],
          y: world[1] * localX + world[3] * localY + world[5],
        };
      },
      sourceWidth: maskWidth,
      sourceHeight: maskHeight,
    };
  }

  private loadAssetIntoMask(dataUrl: string): void {
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
        this.maskData = normalizeMaskImageData(ctx2d.getImageData(0, 0, img.width, img.height));
      } catch {
        this.maskData = null;
      }
    };
    img.onerror = () => {
      this.pendingLoad = false;
      this.maskData = null;
    };
    img.src = dataUrl;
  }

  private resetState(): void {
    this.maskData = null;
    this.maskSnapshot = null;
    this.nodeId = null;
    this.lastPaintedPoint = null;
    this.lastPaintedSource = null;
    this.pendingLoad = false;
    this.mapper = null;
    this.strokeAreaSelection = null;
    this.strokeDirty = false;
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

  /** Paint one dab at a mask/source pixel position. */
  private paintSourcePoint(
    sourcePixel: { x: number; y: number },
    pressure: number,
    mode: RefineBrushMode,
    areaSelection: AreaSelection | null,
  ): void {
    if (!this.maskData) return;
    if (!Number.isFinite(sourcePixel.x) || !Number.isFinite(sourcePixel.y)) return;
    if (!this.brushMask) {
      this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
    }

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
        const selectionWeight =
          this.options.clipToSelection && areaSelection
            ? this.areaSelectionCoverageAtMaskPixel(mx, my, areaSelection)
            : 1;
        const scaledWeight = Math.round(maskWeight * opacityScale * selectionWeight);
        if (scaledWeight === 0) continue;
        const pixelIdx = (my * this.maskData.width + mx) * 4;
        const current = data[pixelIdx]!;
        let next: number;
        if (mode === 'subtract') {
          next = current * (1 - scaledWeight / 255);
        } else if (mode === 'restore') {
          const target = this.maskSnapshot?.data[pixelIdx] ?? current;
          next = current + (target - current) * (scaledWeight / 255);
        } else {
          next = current + (255 - current) * (scaledWeight / 255);
        }
        const rounded = Math.round(next);
        if (rounded === current) continue;
        this.strokeDirty = true;
        data[pixelIdx] = rounded;
        data[pixelIdx + 1] = rounded;
        data[pixelIdx + 2] = rounded;
        data[pixelIdx + 3] = rounded;
      }
    }
  }

  /** Sample the frozen document-space selection at a mask pixel centre. */
  private areaSelectionCoverageAtMaskPixel(
    maskX: number,
    maskY: number,
    selection: AreaSelection | null,
  ): number {
    if (!selection || !this.maskData) return 1;
    const mapper = this.mapper;
    if (!mapper?.mapMaskPixelToWorld) return 1;
    const sourceWidth = mapper.sourceWidth ?? this.maskData.width;
    const sourceHeight = mapper.sourceHeight ?? this.maskData.height;
    const toWorld = (offsetX: number, offsetY: number): number => {
      const sourcePoint = {
        x: ((maskX + offsetX) / this.maskData!.width) * sourceWidth,
        y: ((maskY + offsetY) / this.maskData!.height) * sourceHeight,
      };
      const world = mapper.mapMaskPixelToWorld?.(sourcePoint) ?? null;
      return world ? areaSelectionCoverageAt(selection, world) : 0;
    };
    if (!selectionUsesAntialias(selection.expression)) return toWorld(0.5, 0.5);
    return (
      (toWorld(0.25, 0.25) + toWorld(0.75, 0.25) + toWorld(0.25, 0.75) + toWorld(0.75, 0.75)) / 4
    );
  }

  private commitMask(ctx: ToolContext): void {
    if (!this.maskData || !this.nodeId) return;

    const newDataUrl = this.encodeMask(this.maskData);
    if (!newDataUrl) return;

    ctx.commitRasterMask?.(
      this.nodeId,
      newDataUrl,
      this.maskData.width,
      this.maskData.height,
      this.coordinateSpace,
    );
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

function selectionUsesAntialias(expression: AreaSelection['expression']): boolean {
  if (expression.kind === 'shape') return expression.shape.antialias;
  return selectionUsesAntialias(expression.left) || selectionUsesAntialias(expression.right);
}
