/**
 * Sam2SegmentationTool — interactive object segmentation via SAM2.
 *
 * Click to add foreground points, Shift+click for background points,
 * drag to create a bounding box. Runs SAM2 inference through the
 * generic multi-model worker to produce a selection mask.
 *
 * Research basis: SAM2 (Meta, 2024) — point/box promptable segmentation,
 *                 Figma's "Select subject" feature, Photoshop's "Select Subject".
 */
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

interface SegmentationPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

export class Sam2SegmentationTool extends BaseTool {
  id = 'sam2Segment' as const;
  private points: SegmentationPoint[] = [];
  private pendingBox: { x1: number; y1: number; x2: number; y2: number } | null = null;
  private pendingPoint: SegmentationPoint | null = null;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onActivate(_ctx: ToolContext): void {
    this.points = [];
    this.pendingBox = null;
    this.pendingPoint = null;
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (e.button !== 0) return { consumed: false };

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    // A press is a point only after pointer-up confirms that it did not become
    // a box. This prevents a box prompt from silently receiving an extra
    // foreground point at its top-left corner.
    this.pendingPoint = { x: world.x, y: world.y, label: e.shiftKey ? 0 : 1 };
    this.pendingBox = null;
    return super.onPointerDown(e, ctx);
  }

  override onDragMove(ctx: ToolContext): void {
    if (!this.pendingPoint) return;
    const world = ctx.canvasToWorld(this.drag.currentCanvas.x, this.drag.currentCanvas.y);
    this.pendingBox = {
      x1: this.pendingPoint.x,
      y1: this.pendingPoint.y,
      x2: world.x,
      y2: world.y,
    };
  }

  override onDragEnd(ctx: ToolContext): void {
    const point = this.pendingPoint;
    this.pendingPoint = null;
    if (!point) return;

    const moved =
      this.drag.kind === 'dragging' &&
      (Math.abs(this.drag.currentCanvas.x - this.drag.startCanvas.x) > 3 ||
        Math.abs(this.drag.currentCanvas.y - this.drag.startCanvas.y) > 3);
    if (!moved || !this.pendingBox) {
      this.pendingBox = null;
      this.points.push(point);
    }

    // Trigger segmentation
    void this.runSegmentation(ctx);
  }

  override onDragCancel(_ctx: ToolContext): void {
    this.pendingPoint = null;
    this.pendingBox = null;
  }

  override onKeyDown(e: PointerEvent | KeyboardEvent, ctx: ToolContext): boolean {
    if (!(e instanceof KeyboardEvent)) return false;
    if (e.key === 'Escape') {
      this.points = [];
      this.pendingPoint = null;
      this.pendingBox = null;
      ctx.announce('Selection cancelled');
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (this.points.length === 0) return false;
      this.points.pop();
      void this.runSegmentation(ctx);
      return true;
    }
    if (e.key === 'Enter') {
      if (this.points.length === 0 && !this.pendingBox) return false;
      void this.commitSegmentation(ctx);
      return true;
    }
    return false;
  }

  private buildPrompts(): {
    points?: Array<{ x: number; y: number; label: 0 | 1 }>;
    box?: { x1: number; y1: number; x2: number; y2: number };
  } {
    const points = this.points.map((p) => ({ x: p.x, y: p.y, label: p.label as 0 | 1 }));
    const prompts: {
      points?: typeof points;
      box?: { x1: number; y1: number; x2: number; y2: number };
    } = {};
    if (points.length > 0) prompts.points = points;
    if (this.pendingBox) {
      prompts.box = {
        x1: this.pendingBox.x1,
        y1: this.pendingBox.y1,
        x2: this.pendingBox.x2,
        y2: this.pendingBox.y2,
      };
    }
    return prompts;
  }

  private async runSegmentation(ctx: ToolContext): Promise<void> {
    if (this.points.length === 0 && !this.pendingBox) return;
    if (!ctx.applySam2Segmentation) return;

    const selection = ctx.selection;
    if (!selection || selection.length === 0) return;
    const nodeId = selection[0]!;
    const prompts = this.buildPrompts();

    try {
      ctx.announce('Analyzing subject…');
      await ctx.applySam2Segmentation({
        nodeId,
        prompts,
        operation: 'preview',
      });
    } catch {
      ctx.announce('Subject selection cancelled');
    }
  }

  /** Commit the current preview as a non-destructive mask (Enter key). */
  private async commitSegmentation(ctx: ToolContext): Promise<void> {
    if (!ctx.applySam2Segmentation) return;
    const selection = ctx.selection;
    if (!selection || selection.length === 0) return;
    const nodeId = selection[0]!;
    const prompts = this.buildPrompts();

    try {
      await ctx.applySam2Segmentation({
        nodeId,
        prompts,
        operation: 'mask',
      });
      this.points = [];
      this.pendingBox = null;
    } catch {
      ctx.announce('Could not apply selection');
    }
  }

  /** Get current prompts for external consumption */
  getPrompts(): {
    points: SegmentationPoint[];
    box: { x1: number; y1: number; x2: number; y2: number } | null;
  } {
    return { points: [...this.points], box: this.pendingBox };
  }

  /** Clear all prompts */
  clearPrompts(): void {
    this.points = [];
    this.pendingBox = null;
  }
}
