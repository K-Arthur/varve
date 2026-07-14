/**
 * CropTool — viewport crop mode for image shapes.
 *
 * Overlay owns handle dragging; this tool handles Esc / Enter and activation.
 * Research basis: Figma image crop, Canva crop handle pattern.
 */

import type { LocalCropRect } from '../imageCrop';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export class CropTool extends BaseTool {
  id = 'crop' as const;

  private cropRect: LocalCropRect | null = null;
  private nodeId: string | null = null;
  private nodeSize: { w: number; h: number } | null = null;
  private listeners = new Set<() => void>();
  private commitHandler: ((rect: LocalCropRect) => void) | null = null;

  /** Subscribe to crop-rect changes (overlay re-renders). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  setCommitHandler(handler: ((rect: LocalCropRect) => void) | null): void {
    this.commitHandler = handler;
  }

  getCropRect(): LocalCropRect | null {
    return this.cropRect;
  }

  getNodeId(): string | null {
    return this.nodeId;
  }

  getNodeSize(): { w: number; h: number } | null {
    return this.nodeSize;
  }

  setCropRect(rect: LocalCropRect): void {
    this.cropRect = rect;
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
    const node = ctx.getNode(id);
    if (node?.kind !== 'shape' || node.shape.kind !== 'rect') {
      ctx.announce('Crop requires an image rectangle');
      ctx.setTool('select');
      return;
    }
    this.nodeSize = { w: node.shape.w, h: node.shape.h };
    this.cropRect = { x: 0, y: 0, w: node.shape.w, h: node.shape.h };
    this.notify();
    ctx.announce('Crop mode — drag handles, Enter to apply, Esc to cancel');
  }

  override onDeactivate(_ctx: ToolContext): void {
    this.cropRect = null;
    this.nodeId = null;
    this.nodeSize = null;
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
      if (this.cropRect && this.commitHandler) {
        this.commitHandler(this.cropRect);
      }
      ctx.setTool('select');
      return true;
    }
    return false;
  }

  /** Ignore canvas pointer so overlay can capture handle drags. */
  override onPointerDown(): { consumed: boolean } {
    return { consumed: true };
  }

  applyCrop(ctx: ToolContext): void {
    if (this.cropRect && this.commitHandler) {
      this.commitHandler(this.cropRect);
    }
    ctx.setTool('select');
  }

  cancel(ctx: ToolContext): void {
    ctx.setTool('select');
    ctx.announce('Crop cancelled');
  }
}
