/**
 * TrimapEditTool — three-zone trimap painting for difficult edges.
 *
 * Modes: Foreground (255), Unknown (128), Background (0).
 * Ephemeral trimap lives in editor state until applied via matting.
 *
 * Research basis: Levin closed-form matting trimap; Photoshop Select & Mask.
 */
import { createBrushMask, TRIMap } from '@strata/engine';
import type { ShapeNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export type TrimapPenMode = 'foreground' | 'unknown' | 'background';

interface TrimapEditOptions {
  brushSize: number;
  hardness: number;
  penMode: TrimapPenMode;
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

  override onActivate(ctx: ToolContext): void {
    this.brushMask = createBrushMask(this.options.brushSize, this.options.hardness).mask;
    this.initTrimap(ctx);
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.trimap = null;
    this.nodeId = null;
    this.lastPaintedPoint = null;
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
    this.paintStroke(world);
    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    if (!this.lastPaintedPoint || !this.trimap) return;
    const world = this.drag.currentWorld;
    const dx = world.x - this.lastPaintedPoint.x;
    const dy = world.y - this.lastPaintedPoint.y;
    if (Math.sqrt(dx * dx + dy * dy) < Math.max(1, this.options.brushSize * 0.3)) return;
    this.paintStroke(world);
    this.lastPaintedPoint = world;
    ctx.setTrimapPreview?.(this.trimap, this.width, this.height);
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
    if (!node || !isImageShape(node) || !node.backgroundRemoval?.maskDataUrl) return;

    this.nodeId = node.id;
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
    img.src = node.backgroundRemoval.maskDataUrl;
  }

  private paintStroke(world: { x: number; y: number }): void {
    if (!this.trimap) return;
    const value = penValue(this.options.penMode);
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
        if (mx < 0 || mx >= this.width || my < 0 || my >= this.height) continue;
        const weight = this.brushMask ? (this.brushMask[by * d + bx] ?? 0) : 255;
        if (weight < 32) continue;
        this.trimap[my * this.width + mx] = value;
      }
    }
  }
}
