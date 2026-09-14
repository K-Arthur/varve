/**
 * Sam2SegmentationTool — interactive object segmentation via SAM2.
 *
 * Click to add foreground points, Shift+click for background points, and
 * drag to create a box. Box mode also supports the WCAG-recommended
 * two-tap corner gesture. Tapping an existing point marker removes that
 * specific prompt (the single-pointer alternative to keyboard deletion),
 * while dragging a marker moves that prompt and Backspace/Delete removes the
 * last staged prompt. Prompt geometry is mirrored into transient editor state
 * while it is being drawn so the overlay and inspector have one source of
 * truth. Only the completed prompt is sent to the model.
 */
import { BaseTool } from './BaseTool';
import { worldDistanceForCssPixels } from './inputNormalizer';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

interface SegmentationPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

type SegmentationBox = { x1: number; y1: number; x2: number; y2: number };
export type Sam2PromptMode = 'point' | 'box';
export type Sam2PromptPolarity = 'include' | 'exclude';

const DRAG_THRESHOLD_CSS_PX = 3;
// Tapping an existing include/exclude marker removes that specific prompt.
// The radius is in CSS pixels so it follows the user's hand, not the camera
// zoom, and it is the single-pointer alternative to keyboard deletion.
const PROMPT_REMOVE_HIT_CSS_PX = 10;

export class Sam2SegmentationTool extends BaseTool {
  id = 'sam2Segment' as const;
  private points: SegmentationPoint[] = [];
  private box: SegmentationBox | null = null;
  private pendingBox: SegmentationBox | null = null;
  private pendingPoint: SegmentationPoint | null = null;
  private boxAnchor: { x: number; y: number } | null = null;
  private movingPointIndex: number | null = null;
  private movingPointOriginal: SegmentationPoint | null = null;
  private movingPointDidMove = false;
  private promptMode: Sam2PromptMode = 'point';
  private promptPolarity: 0 | 1 = 1;

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

  /** Select point prompts or the two-tap/drag box-hint gesture. */
  setPromptMode(mode: Sam2PromptMode): void {
    this.promptMode = mode;
    this.pendingBox = null;
    this.pendingPoint = null;
    this.boxAnchor = null;
    this.movingPointIndex = null;
    this.movingPointOriginal = null;
    this.movingPointDidMove = false;
  }

  /** Set the default polarity for new point prompts. Shift still forces exclude. */
  setPromptPolarity(polarity: Sam2PromptPolarity): void {
    this.promptPolarity = polarity === 'include' ? 1 : 0;
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (e.button !== 0) return { consumed: false };

    this.syncFromSession(ctx);
    const world = ctx.canvasToWorld(e.clientX, e.clientY);

    // A tap on an existing prompt marker removes exactly that prompt, while
    // dragging it moves the prompt. This is deliberately handled before a
    // new point is staged so the marker gesture is never also interpreted as
    // adding to the prompt set.
    const markerIndex = this.findMarkerIndex(world, ctx.zoom);
    if (markerIndex >= 0) {
      const marker = this.points[markerIndex];
      if (!marker) return { consumed: false };
      if (ctx.objectSelectionSession && ctx.objectSelectionSession.status !== 'drawing') {
        ctx.cancelSam2Segmentation?.();
      }
      this.movingPointIndex = markerIndex;
      this.movingPointOriginal = { ...marker };
      this.movingPointDidMove = false;
      this.pendingPoint = null;
      this.pendingBox = null;
      return super.onPointerDown(e, ctx);
    }

    // A new prompt supersedes an older encoder/decoder request immediately,
    // not only after pointer-up. This closes the small race where an old
    // result could publish between the next pointer-down and pointer-up.
    if (ctx.objectSelectionSession && ctx.objectSelectionSession.status !== 'drawing') {
      ctx.cancelSam2Segmentation?.();
    }
    this.pendingPoint = {
      x: world.x,
      y: world.y,
      label: e.shiftKey ? 0 : this.promptPolarity,
    };
    this.pendingBox = null;
    this.patchPrompts(ctx, 'drawing', {
      draftPoint: this.promptMode === 'point' ? this.pendingPoint : null,
      draftBox:
        this.promptMode === 'box' ? { x1: world.x, y1: world.y, x2: world.x, y2: world.y } : null,
      invalidatePreview: true,
    });
    return super.onPointerDown(e, ctx);
  }

  /** Index of the include/exclude marker within the removal radius, or -1. */
  private findMarkerIndex(world: { x: number; y: number }, zoom: number): number {
    const tolerance = worldDistanceForCssPixels(
      PROMPT_REMOVE_HIT_CSS_PX,
      Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    );
    for (let index = this.points.length - 1; index >= 0; index -= 1) {
      const point = this.points[index]!;
      if (Math.hypot(point.x - world.x, point.y - world.y) <= tolerance) return index;
    }
    return -1;
  }

  override onDragMove(ctx: ToolContext): void {
    if (this.movingPointIndex !== null) {
      const point = this.points[this.movingPointIndex];
      if (!point) return;
      const world = ctx.canvasToWorld(this.drag.currentCanvas.x, this.drag.currentCanvas.y);
      this.points[this.movingPointIndex] = { ...point, x: world.x, y: world.y };
      this.patchPrompts(ctx, 'drawing', {
        draftPoint: null,
        draftBox: null,
        invalidatePreview: !this.movingPointDidMove,
      });
      this.movingPointDidMove = true;
      return;
    }
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
    if (this.movingPointIndex !== null) {
      const index = this.movingPointIndex;
      const moved =
        this.drag.kind === 'dragging' &&
        (Math.abs(this.drag.currentCanvas.x - this.drag.startCanvas.x) > DRAG_THRESHOLD_CSS_PX ||
          Math.abs(this.drag.currentCanvas.y - this.drag.startCanvas.y) > DRAG_THRESHOLD_CSS_PX);
      this.movingPointIndex = null;
      this.movingPointOriginal = null;
      this.movingPointDidMove = false;

      if (moved) {
        this.patchPrompts(ctx, 'previewing', {
          draftPoint: null,
          draftBox: null,
          invalidatePreview: true,
        });
        void this.runSegmentation(ctx);
        ctx.announce('Prompt moved');
      } else {
        this.points.splice(index, 1);
        this.patchPrompts(ctx, 'previewing', {
          draftPoint: null,
          draftBox: null,
          invalidatePreview: true,
        });
        if (this.points.length > 0 || this.box) void this.runSegmentation(ctx);
        else ctx.cancelSam2Segmentation?.();
        ctx.announce('Prompt removed');
      }
      return;
    }

    const point = this.pendingPoint;
    this.pendingPoint = null;
    if (!point) return;

    const moved =
      this.drag.kind === 'dragging' &&
      (Math.abs(this.drag.currentCanvas.x - this.drag.startCanvas.x) > DRAG_THRESHOLD_CSS_PX ||
        Math.abs(this.drag.currentCanvas.y - this.drag.startCanvas.y) > DRAG_THRESHOLD_CSS_PX);

    if (this.promptMode === 'box') {
      if (moved && this.pendingBox) {
        this.box = normalizedBox(this.pendingBox);
        this.boxAnchor = null;
        this.pendingBox = null;
        this.patchPrompts(ctx, 'previewing', { draftPoint: null, draftBox: null });
        void this.runSegmentation(ctx);
        return;
      }

      if (!this.boxAnchor) {
        // A click in Box hint mode is the first corner. Keep it as draft UI
        // state; the model must not run until the second corner is supplied.
        this.boxAnchor = { x: point.x, y: point.y };
        this.pendingBox = {
          x1: point.x,
          y1: point.y,
          x2: point.x,
          y2: point.y,
        };
        this.patchPrompts(ctx, 'drawing', { draftPoint: null, draftBox: this.pendingBox });
        ctx.announce('Box first corner set; tap a second corner or drag.');
        return;
      }

      this.box = normalizedBox({
        x1: this.boxAnchor.x,
        y1: this.boxAnchor.y,
        x2: point.x,
        y2: point.y,
      });
      this.boxAnchor = null;
      this.pendingBox = null;
      this.patchPrompts(ctx, 'previewing', { draftPoint: null, draftBox: null });
      void this.runSegmentation(ctx);
      return;
    }

    if (moved && this.pendingBox) {
      this.box = normalizedBox(this.pendingBox);
    } else {
      this.points.push(point);
    }
    this.pendingBox = null;
    this.patchPrompts(ctx, 'previewing', { draftPoint: null, draftBox: null });
    void this.runSegmentation(ctx);
  }

  override onDragCancel(ctx: ToolContext): void {
    if (this.movingPointIndex !== null && this.movingPointOriginal) {
      this.points[this.movingPointIndex] = { ...this.movingPointOriginal };
    }
    this.pendingPoint = null;
    this.pendingBox = null;
    this.boxAnchor = null;
    this.movingPointIndex = null;
    this.movingPointOriginal = null;
    this.movingPointDidMove = false;
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
      } else if (this.boxAnchor) {
        this.boxAnchor = null;
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
    this.boxAnchor = null;
    this.movingPointIndex = null;
    this.movingPointOriginal = null;
    this.movingPointDidMove = false;
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

function normalizedBox(box: SegmentationBox): SegmentationBox {
  return {
    x1: Math.min(box.x1, box.x2),
    y1: Math.min(box.y1, box.y2),
    x2: Math.max(box.x1, box.x2),
    y2: Math.max(box.y1, box.y2),
  };
}
