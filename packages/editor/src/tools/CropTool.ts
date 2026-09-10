/**
 * CropTool — viewport crop mode for image shapes.
 *
 * Overlay owns handle dragging; this tool handles Esc / Enter / wheel zoom
 * and fit-mode cycling.
 *
 * The crop is stored on the image fill in source-pixel coordinates, so it
 * is re-editable: entering crop mode on an already-cropped image reads the
 * existing crop and displays it.
 *
 * Research basis: Figma image crop, Canva crop handle pattern.
 */

import { computeImagePlacement, sourcePixelToLocal } from '@varve/engine';
import type { ImageFillData, ImageFit } from '@varve/scene';
import { isImageShape, nodeLocalBounds } from '@varve/scene';
import type { CropState, LocalCropRect } from '../imageCrop';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

const FIT_CYCLE: ImageFit[] = ['crop', 'fit', 'fill', 'stretch', 'tile'];

function cropViewportFromPlacement(
  image: ImageFillData,
  nodeW: number,
  nodeH: number,
): LocalCropRect | null {
  const sourceWidth = image.imageWidth ?? nodeW;
  const sourceHeight = image.imageHeight ?? nodeH;
  const crop = image.crop;
  if (!crop) return null;
  const placement = computeImagePlacement({
    fit: image.fit ?? 'fill',
    sourceWidth,
    sourceHeight,
    bounds: { x: 0, y: 0, w: nodeW, h: nodeH },
    x: image.x,
    y: image.y,
    scale: image.scale,
    rotation: image.rotation,
    flipH: image.flipH,
    flipV: image.flipV,
  });
  if (!placement) return null;
  const insetX = Math.max(1e-9, sourceWidth * Number.EPSILON * 4);
  const insetY = Math.max(1e-9, sourceHeight * Number.EPSILON * 4);
  const right = crop.x + crop.w - insetX;
  const bottom = crop.y + crop.h - insetY;
  const points = [
    { x: crop.x, y: crop.y },
    { x: right, y: crop.y },
    { x: right, y: bottom },
    { x: crop.x, y: bottom },
  ]
    .map((point) => sourcePixelToLocal(placement, point))
    .filter((point): point is { x: number; y: number } => point !== null);
  if (points.length === 0) return null;
  const minX = Math.max(0, Math.min(...points.map((point) => point.x)));
  const minY = Math.max(0, Math.min(...points.map((point) => point.y)));
  const maxX = Math.min(nodeW, Math.max(...points.map((point) => point.x)));
  const maxY = Math.min(nodeH, Math.max(...points.map((point) => point.y)));
  if (maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export class CropTool extends BaseTool {
  id = 'crop' as const;

  private cropState: CropState | null = null;
  private nodeId: string | null = null;
  private nodeSize: { w: number; h: number } | null = null;
  private shapeKind: string = 'rect';
  private shapeParams: Record<string, unknown> = {};
  private listeners = new Set<() => void>();
  private commitHandler: ((state: CropState) => void) | null = null;

  /** Subscribe to crop state changes (overlay re-renders). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  setCommitHandler(handler: ((state: CropState) => void) | null): void {
    this.commitHandler = handler;
  }

  getCropState(): CropState | null {
    return this.cropState;
  }

  getCropRect(): LocalCropRect | null {
    return this.cropState?.viewport ?? null;
  }

  getNodeId(): string | null {
    return this.nodeId;
  }

  getNodeSize(): { w: number; h: number } | null {
    return this.nodeSize;
  }

  getShapeKind(): string {
    return this.shapeKind;
  }

  getShapeParams(): Record<string, unknown> {
    return this.shapeParams;
  }

  setCropRect(rect: LocalCropRect): void {
    this.cropState = { ...this.cropState!, viewport: rect };
    this.notify();
  }

  /** Set the straighten angle in degrees. Applied to image rotation on commit. */
  setStraightenAngle(angle: number): void {
    if (!this.cropState) return;
    this.cropState = { ...this.cropState, straightenAngle: angle };
    this.notify();
  }

  getStraightenAngle(): number {
    return this.cropState?.straightenAngle ?? 0;
  }

  /** Set the fill scale (zoom level). */
  setFillScale(scale: number): void {
    if (!this.cropState) return;
    this.cropState = { ...this.cropState, fillScale: Math.max(0.01, Math.min(10, scale)) };
    this.notify();
  }

  /** Pan the image fill offset by a delta in node-local space. */
  panFill(dx: number, dy: number): void {
    if (!this.cropState) return;
    this.setFillOffset(
      (this.cropState.fillOffsetX ?? 0) + dx,
      (this.cropState.fillOffsetY ?? 0) + dy,
    );
  }

  /** Set image-content offset absolutely for drift-free pointer dragging. */
  setFillOffset(x: number, y: number): void {
    if (!this.cropState || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.cropState = { ...this.cropState, fillOffsetX: x, fillOffsetY: y };
    this.notify();
  }

  /** Cycle to the next fit mode. */
  cycleFitMode(): void {
    if (!this.cropState) return;
    const current = this.cropState.fillFit;
    const idx = current ? FIT_CYCLE.indexOf(current) : -1;
    const next = FIT_CYCLE[(idx + 1) % FIT_CYCLE.length];
    this.cropState = { ...this.cropState, fillFit: next };
    this.notify();
  }

  override onActivate(ctx: ToolContext): void {
    this.cropState = null;
    this.nodeId = null;
    this.nodeSize = null;
    if (ctx.selection.length !== 1) {
      ctx.announce('Select one image to crop');
      ctx.setTool('select');
      return;
    }
    const id = ctx.selection[0] ?? null;
    if (!id) {
      ctx.announce('Select an image to crop');
      ctx.setTool('select');
      return;
    }
    const doc = ctx.document;
    const node = ctx.getNode(id);
    if (node?.kind !== 'shape' || !isImageShape(node)) {
      ctx.announce('Crop requires a shape with an image fill');
      ctx.setTool('select');
      return;
    }
    // Use nodeLocalBounds to support any shape kind (not just rect)
    const bounds = nodeLocalBounds(node, doc);
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
      ctx.announce('Crop requires a shape with measurable bounds');
      ctx.setTool('select');
      return;
    }
    this.nodeId = id;
    this.nodeSize = { w: bounds.w, h: bounds.h };
    // Store shape kind and params for canvas preview clipping
    if ('shape' in node) {
      const shape = node.shape as { kind?: string };
      this.shapeKind = shape.kind ?? 'rect';
      this.shapeParams = node.shape as Record<string, unknown>;
    } else {
      this.shapeKind = 'rect';
      this.shapeParams = {};
    }
    const imageFill =
      'fills' in node
        ? (node.fills ?? []).find((f: { type: string }) => f.type === 'image')?.image
        : null;

    // If the image already has a crop, convert from source-pixel space to
    // node-local space so the overlay shows the current crop boundary.
    let viewport: LocalCropRect;
    if (imageFill?.crop) {
      viewport = cropViewportFromPlacement(imageFill, bounds.w, bounds.h) ?? {
        x: 0,
        y: 0,
        w: bounds.w,
        h: bounds.h,
      };
    } else {
      viewport = { x: 0, y: 0, w: bounds.w, h: bounds.h };
    }

    this.cropState = {
      viewport,
      fillScale: imageFill?.scale ?? 1,
      fillOffsetX: imageFill?.x ?? 0,
      fillOffsetY: imageFill?.y ?? 0,
      // Keep the same default as computeImagePlacement. Treating an omitted
      // historical fit as `crop` silently changed an untouched image when
      // the crop mode was accepted.
      fillFit: imageFill?.fit ?? 'fill',
    };
    this.notify();
    ctx.announce('Crop mode — drag handles, scroll to zoom, Enter to apply, Esc to cancel');
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.cropState = null;
    this.nodeId = null;
    this.nodeSize = null;
    this.shapeKind = 'rect';
    this.shapeParams = {};
    this.notify();
  }

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'default' };
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape') {
      ctx.setTool('select');
      ctx.announce('Crop cancelled');
      return true;
    }
    if (e.key === 'Enter') {
      if (this.cropState && this.commitHandler) {
        this.commitHandler(this.cropState);
      }
      ctx.setTool('select');
      return true;
    }
    if (e.key === 'f' || e.key === 'F') {
      this.cycleFitMode();
      ctx.announce(`Crop fit: ${this.cropState?.fillFit ?? 'crop'}`);
      return true;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const step = e.shiftKey ? 10 : 1;
      const d = {
        ArrowUp: [0, -step] as const,
        ArrowDown: [0, step] as const,
        ArrowLeft: [-step, 0] as const,
        ArrowRight: [step, 0] as const,
      }[e.key]!;
      if (e.altKey) {
        this.panFill(d[0], d[1]);
      } else if (this.cropState && this.nodeSize) {
        const { viewport } = this.cropState;
        const x = Math.max(0, Math.min(viewport.x + d[0], this.nodeSize.w - viewport.w));
        const y = Math.max(0, Math.min(viewport.y + d[1], this.nodeSize.h - viewport.h));
        this.setCropRect({ ...viewport, x, y });
      }
      return true;
    }
    return false;
  }

  /** Ignore canvas pointer so overlay can capture handle drags. */
  override onPointerDown(): { consumed: boolean } {
    return { consumed: true };
  }

  applyCrop(ctx: ToolContext): void {
    if (this.cropState && this.commitHandler) {
      this.commitHandler(this.cropState);
    }
    ctx.setTool('select');
  }

  cancel(ctx: ToolContext): void {
    ctx.setTool('select');
    ctx.announce('Crop cancelled');
  }
}
