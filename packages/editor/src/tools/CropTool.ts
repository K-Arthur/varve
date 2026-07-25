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

import type { ImageFit } from '@strata/scene';
import { nodeLocalBounds } from '@strata/scene';
import type { CropState, LocalCropRect } from '../imageCrop';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

const FIT_CYCLE: ImageFit[] = ['crop', 'fit', 'fill', 'stretch', 'tile'];

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

  /** Set the fill scale (zoom level). */
  setFillScale(scale: number): void {
    if (!this.cropState) return;
    this.cropState = { ...this.cropState, fillScale: Math.max(0.01, Math.min(10, scale)) };
    this.notify();
  }

  /** Pan the image fill offset by a delta in node-local space. */
  panFill(dx: number, dy: number): void {
    if (!this.cropState) return;
    const offX = (this.cropState.fillOffsetX ?? 0) + dx;
    const offY = (this.cropState.fillOffsetY ?? 0) + dy;
    this.cropState = { ...this.cropState, fillOffsetX: offX, fillOffsetY: offY };
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
    const id = ctx.selection[0] ?? null;
    this.nodeId = id;
    if (!id) {
      ctx.announce('Select an image to crop');
      ctx.setTool('select');
      return;
    }
    const doc = ctx.document;
    const node = ctx.getNode(id);
    if (node?.kind !== 'shape') {
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
    if (imageFill?.crop && imageFill.imageWidth && imageFill.imageHeight) {
      const nodeW = bounds.w;
      const nodeH = bounds.h;
      const srcW = imageFill.imageWidth;
      const srcH = imageFill.imageHeight;
      viewport = {
        x: (imageFill.crop.x / srcW) * nodeW,
        y: (imageFill.crop.y / srcH) * nodeH,
        w: (imageFill.crop.w / srcW) * nodeW,
        h: (imageFill.crop.h / srcH) * nodeH,
      };
    } else {
      viewport = { x: 0, y: 0, w: bounds.w, h: bounds.h };
    }

    this.cropState = {
      viewport,
      fillScale: imageFill?.scale ?? 1,
      fillOffsetX: imageFill?.x ?? 0,
      fillOffsetY: imageFill?.y ?? 0,
      fillFit: imageFill?.fit ?? 'crop',
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
    // Alt+arrows for nudge pan
    if (e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const step = 5;
      const d = {
        ArrowUp: [0, -step] as const,
        ArrowDown: [0, step] as const,
        ArrowLeft: [-step, 0] as const,
        ArrowRight: [step, 0] as const,
      }[e.key]!;
      this.panFill(d[0], d[1]);
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
