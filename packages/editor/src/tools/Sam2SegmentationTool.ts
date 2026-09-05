/**
 * Sam2SegmentationTool — interactive object segmentation via SAM2.
 *
 * Click to add foreground points, Shift+click for background points, and
 * drag to create a box. Prompt geometry is mirrored into transient editor
 * state while it is being drawn so the overlay and inspector have one source
 * of truth. Only the completed prompt is sent to the model.
 */
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

interface SegmentationPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

type SegmentationBox = { x1: number; y1: number; x2: number; y2: number };

const DRAG_THRESHOLD_CSS_PX = 3;

export class Sam2SegmentationTool extends BaseTool {
  id = 'sam2Segment' as const;
  private points: SegmentationPoint[] = [];
  private box: SegmentationBox | null = null;
  private pendingBox: SegmentationBox | null = null;
  private pendingPoint: SegmentationPoint | null = null;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onActivate(_ctx: ToolContext): void {
    this.clearLocalPrompts();
  }

  override onDeactivate(ctx: ToolContext): void {
    this.clearLocalPrompts();
    ctx.cancelSam2Segmentation?.();
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (e.button !== 0) return { consumed: false };

    this.syncFromSession(ctx);
    // A new prompt supersedes an older encoder/decoder request immediately,
    // not only after pointer-up. This closes the small race where an old
    // result could publish between the next pointer-down and pointer-up.
    if (ctx.objectSelectionSession && ctx.objectSelectionSession.status !== 'drawing') {
      ctx.cancelSam2Segmentation?.();
    }
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    this.pendingPoint = { x: world.x, y: world.y, label: e.shiftKey ? 0 : 1 };
    this.pendingBox = null;
    this.patchPrompts(ctx, 'drawing', {
      draftPoint: this.pendingPoint,
      draftBox: null,
      invalidatePreview: true,
    });
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
    this.patchPrompts(ctx, 'drawing', { draftPoint: null, draftBox: this.pendingBox });
  }

  override onDragEnd(ctx: ToolContext): void {
    const point = this.pendingPoint;
    this.pendingPoint = null;
    if (!point) return;

    const moved =
      this.drag.kind === 'dragging' &&
      (Math.abs(this.drag.currentCanvas.x - this.drag.startCanvas.x) > DRAG_THRESHOLD_CSS_PX ||
        Math.abs(this.drag.currentCanvas.y - this.drag.startCanvas.y) > DRAG_THRESHOLD_CSS_PX);

    if (moved && this.pendingBox) {
      this.box = this.pendingBox;
    } else {
      this.points.push(point);
    }
    this.pendingBox = null;
    this.patchPrompts(ctx, 'previewing', { draftPoint: null, draftBox: null });
    void this.runSegmentation(ctx);
  }

  override onDragCancel(ctx: ToolContext): void {
    this.pendingPoint = null;
    this.pendingBox = null;
    this.patchPrompts(ctx, 'drawing', { draftPoint: null, draftBox: null });
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    this.syncFromSession(ctx);
    if (e.key === 'Escape') {
      this.clearLocalPrompts();
      ctx.cancelSam2Segmentation?.();
      ctx.announce('Object selection cancelled');
      return true;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (this.pendingBox) {
        this.pendingBox = null;
      } else if (this.box) {
        this.box = null;
      } else if (this.points.length > 0) {
        this.points.pop();
      } else {
        return false;
      }
      this.patchPrompts(ctx, 'previewing', { draftPoint: null, draftBox: null });
      if (this.points.length > 0 || this.box) void this.runSegmentation(ctx);
      else ctx.cancelSam2Segmentation?.();
      return true;
    }

    if (e.key === 'Enter') {
      if (this.points.length === 0 && !this.box) return false;
      if (
        ctx.objectSelectionSession &&
        ctx.objectSelectionSession.status !== 'ready' &&
        ctx.objectSelectionSession.status !== 'error'
      ) {
        ctx.announce('Object selection is still processing. Cancel or wait for the preview.');
        return true;
      }
      void this.commitSegmentation(ctx);
      return true;
    }
    return false;
  }

  private clearLocalPrompts(): void {
    this.points = [];
    this.box = null;
    this.pendingBox = null;
    this.pendingPoint = null;
  }

  private syncFromSession(ctx: ToolContext): void {
    // Lightweight tool tests and embedders may not expose transient editor
    // state. In that case the tool-local compatibility buffer remains the
    // source of truth.
    if (!ctx.patchEditorState) return;
    const session = ctx.objectSelectionSession;
    const nodeId = ctx.selection?.[0];
    if (!session || !nodeId || session.nodeId !== nodeId) {
      this.clearLocalPrompts();
      return;
    }
    if (this.points.length === 0 && !this.box) {
      this.points = session.points.map((point) => ({ ...point }));
      this.box = session.box ? { ...session.box } : null;
    }
  }

  private patchPrompts(
    ctx: ToolContext,
    status: 'drawing' | 'previewing',
    options: {
      draftPoint?: SegmentationPoint | null;
      draftBox?: SegmentationBox | null;
      invalidatePreview?: boolean;
    } = {},
  ): void {
    const nodeId = ctx.selection?.[0];
    if (!nodeId || !ctx.patchEditorState) return;
    const previous =
      ctx.objectSelectionSession?.nodeId === nodeId ? ctx.objectSelectionSession : undefined;
    const invalidatePreview = options.invalidatePreview === true;
    ctx.patchEditorState({
      objectSelectionSession: {
        nodeId,
        documentId: previous?.documentId ?? ctx.document?.id ?? 'unknown',
        width: invalidatePreview ? 0 : (previous?.width ?? 0),
        height: invalidatePreview ? 0 : (previous?.height ?? 0),
        candidates: invalidatePreview ? [] : (previous?.candidates ?? []),
        selectedCandidate: invalidatePreview ? 0 : (previous?.selectedCandidate ?? 0),
        points: this.points.map((point) => ({ ...point })),
        box: this.box ? { ...this.box } : null,
        draftPoint: options.draftPoint ?? null,
        draftBox: options.draftBox ?? null,
        confidence: invalidatePreview ? 0 : (previous?.confidence ?? 0),
        status,
        modelId: previous?.modelId ?? 'sam2-hiera-tiny',
        executionProvider: previous?.executionProvider,
      },
    });
  }

  private buildPrompts(): {
    points?: Array<{ x: number; y: number; label: 0 | 1 }>;
    box?: SegmentationBox;
  } {
    const points = this.points.map((point) => ({ ...point }));
    const prompts: {
      points?: Array<{ x: number; y: number; label: 0 | 1 }>;
      box?: SegmentationBox;
    } = {};
    if (points.length > 0) prompts.points = points;
    if (this.box) prompts.box = { ...this.box };
    return prompts;
  }

  private async runSegmentation(ctx: ToolContext): Promise<void> {
    const prompts = this.buildPrompts();
    if (!prompts.points?.length && !prompts.box) return;
    if (!ctx.applySam2Segmentation) return;
    const nodeId = ctx.selection?.[0];
    if (!nodeId) return;

    await ctx.applySam2Segmentation({ nodeId, prompts, operation: 'preview' });
  }

  /** Commit the visible candidate as a non-destructive mask (Enter key). */
  private async commitSegmentation(ctx: ToolContext): Promise<void> {
    if (!ctx.applySam2Segmentation) return;
    const nodeId = ctx.selection?.[0];
    if (!nodeId) return;
    const prompts = this.buildPrompts();
    const result = await ctx.applySam2Segmentation({
      nodeId,
      prompts,
      operation: 'mask',
      candidateIndex: ctx.objectSelectionSession?.selectedCandidate,
    });
    // A failed/cancelled commit must leave the prompt visible for retry.
    if (result) this.clearLocalPrompts();
  }

  /** Compatibility helper used by tool-level tests and diagnostics. */
  getPrompts(): {
    points: SegmentationPoint[];
    box: SegmentationBox | null;
  } {
    return { points: this.points.map((point) => ({ ...point })), box: this.pendingBox ?? this.box };
  }

  /** Clear local prompt state. The editor-level Escape/cancel path also clears the overlay. */
  clearPrompts(): void {
    this.clearLocalPrompts();
  }
}
