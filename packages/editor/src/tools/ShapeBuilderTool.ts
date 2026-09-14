import type { ShapeBuilderAction, ShapeBuilderFace, ShapeBuilderModel } from '@varve/scene';
import {
  applyShapeBuilderAction,
  buildShapeBuilderModel,
  facesCrossedBySegment,
  hitTestShapeBuilderFace,
} from '@varve/scene';
import type {
  CursorSpec,
  GestureResult,
  ShapeBuilderDraft,
  Tool,
  ToolContext,
  ToolCursorState,
} from './types';

const DRAG_THRESHOLD_CSS_PX = 3;

/**
 * Staged Shape Builder interaction.
 *
 * Pointer movement only changes the ephemeral draft. The document is touched
 * by applyAction, which is called by the overlay buttons or keyboard actions
 * and commits one transaction after the pure scene mutation succeeds.
 */
export class ShapeBuilderTool implements Tool {
  readonly id = 'shapeBuilder' as const;

  private model: ShapeBuilderModel | null = null;
  private modelDoc: ToolContext['document'] | null = null;
  private modelSelectionKey = '';
  private selectedFaceIds = new Set<string>();
  private hoveredFaceId: string | null = null;
  private gesturePointerId = -1;
  private gestureModel: ShapeBuilderModel | null = null;
  private gestureStartCanvas = { x: 0, y: 0 };
  private gestureLastWorld = { x: 0, y: 0 };
  private gesturePath: Array<{ x: number; y: number }> = [];
  private gestureVisited = new Set<string>();
  private gestureToggle = false;
  private gestureDragging = false;
  private selectionBeforeGesture = new Set<string>();

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'default' };
  }

  onActivate(ctx: ToolContext): void {
    this.resetState();
    const model = this.getModel(ctx);
    ctx.announce(
      model.status === 'ready'
        ? 'Shape Builder active. Click or sweep filled regions, then choose an action.'
        : (model.message ?? 'Shape Builder cannot use this selection.'),
    );
    this.publish(ctx, model);
  }

  onDeactivate(ctx: ToolContext): void {
    if (this.gesturePointerId >= 0) ctx.releasePointerCapture(this.gesturePointerId);
    this.resetState();
    ctx.setDraft(null);
  }

  onFocusLoss(ctx: ToolContext): void {
    if (this.gesturePointerId >= 0) {
      ctx.releasePointerCapture(this.gesturePointerId);
      this.selectedFaceIds = new Set(this.selectionBeforeGesture);
      this.gesturePointerId = -1;
      this.gesturePath = [];
      this.gestureModel = null;
      this.gestureDragging = false;
      ctx.announce('Shape Builder gesture canceled.');
    }
    this.publish(ctx);
  }

  onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (e.button !== 0 || this.gesturePointerId >= 0) return { consumed: false };
    const model = this.getModel(ctx);
    if (model.status !== 'ready') {
      ctx.announce(model.message ?? 'Shape Builder cannot use this selection.');
      this.publish(ctx, model);
      return { consumed: true };
    }
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const hit = hitTestShapeBuilderFace(model, world, undefined, { includeEmpty: true });
    this.gesturePointerId = e.pointerId;
    this.gestureModel = model;
    this.gestureStartCanvas = { x: e.clientX, y: e.clientY };
    this.gestureLastWorld = world;
    this.gesturePath = [world];
    this.gestureVisited = new Set<string>();
    const touchMultiSelect =
      e.pointerType === 'touch' && ctx.touchMultiSelect.active && !ctx.touchMultiSelect.suspended;
    this.gestureToggle = e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || touchMultiSelect;
    this.gestureDragging = false;
    this.selectionBeforeGesture = new Set(this.selectedFaceIds);
    if (!this.gestureToggle) this.selectedFaceIds.clear();
    if (hit) {
      this.applyFaceSelection(hit, this.gestureToggle);
      this.gestureVisited.add(hit.id);
    }
    ctx.setPointerCapture(e.pointerId);
    this.publish(ctx, model);
    return { consumed: true, captured: true };
  }

  onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    const model = this.gestureModel ?? this.getModel(ctx);
    if (model.status !== 'ready') {
      this.hoveredFaceId = null;
      this.publish(ctx, model);
      return;
    }
    if (this.gesturePointerId < 0) {
      const world = ctx.canvasToWorld(e.clientX, e.clientY);
      this.hoveredFaceId =
        hitTestShapeBuilderFace(model, world, undefined, { includeEmpty: true })?.id ?? null;
      this.publish(ctx, model);
      return;
    }
    if (this.gesturePointerId !== e.pointerId || this.gestureModel !== model) return;
    if (this.modelDoc !== ctx.document) {
      this.cancelGesture(ctx, 'Source geometry changed; the Shape Builder preview was discarded.');
      return;
    }
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    this.gesturePath.push(world);
    const dx = e.clientX - this.gestureStartCanvas.x;
    const dy = e.clientY - this.gestureStartCanvas.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_CSS_PX) this.gestureDragging = true;
    if (this.gestureDragging) {
      for (const face of facesCrossedBySegment(model, this.gestureLastWorld, world, {
        includeEmpty: true,
      })) {
        if (this.gestureToggle) {
          if (!this.gestureVisited.has(face.id)) {
            this.applyFaceSelection(face, true);
            this.gestureVisited.add(face.id);
          }
        } else {
          this.selectedFaceIds.add(face.id);
        }
      }
    }
    this.gestureLastWorld = world;
    this.hoveredFaceId =
      hitTestShapeBuilderFace(model, world, undefined, { includeEmpty: true })?.id ?? null;
    this.publish(ctx, model);
  }

  onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.gesturePointerId !== e.pointerId) return;
    ctx.releasePointerCapture(e.pointerId);
    this.gesturePointerId = -1;
    this.gestureModel = null;
    this.gesturePath = [];
    this.gestureVisited.clear();
    this.gestureDragging = false;
    this.publish(ctx);
    ctx.announce(
      this.selectedFaceIds.size === 0
        ? 'No filled region selected.'
        : `${this.selectedFaceIds.size} region${this.selectedFaceIds.size === 1 ? '' : 's'} selected. Choose Merge, Erase, Extract, Create, or Divide.`,
    );
  }

  onPointerCancel(e: PointerEvent, ctx: ToolContext): void {
    if (this.gesturePointerId !== e.pointerId) return;
    this.cancelGesture(ctx, 'Shape Builder gesture canceled.');
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.gesturePointerId >= 0) {
        this.cancelGesture(ctx, 'Shape Builder gesture canceled.');
      } else if (this.selectedFaceIds.size > 0) {
        this.selectedFaceIds.clear();
        this.publish(ctx);
        ctx.announce('Shape Builder region selection cleared.');
      } else {
        ctx.setTool('select');
      }
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const key = e.key.toLowerCase();
    const action: ShapeBuilderAction | null =
      key === 'm'
        ? 'merge'
        : key === 'e' || e.key === 'Delete' || e.key === 'Backspace'
          ? 'erase'
          : key === 'x'
            ? 'extract'
            : key === 'c'
              ? 'create'
              : key === 'd'
                ? 'divide'
                : e.key === 'Enter'
                  ? 'merge'
                  : null;
    if (!action) return false;
    e.preventDefault();
    this.applyAction(action, ctx);
    return true;
  }

  /** Called by the overlay’s explicit action buttons. */
  applyAction(action: ShapeBuilderAction, ctx: ToolContext): void {
    const model = this.getModel(ctx);
    if (model.status !== 'ready') {
      ctx.announce(model.message ?? 'Shape Builder cannot use this selection.');
      return;
    }
    const result = applyShapeBuilderAction(
      ctx.document,
      ctx.selection,
      [...this.selectedFaceIds],
      action,
      { expectedRevision: model.revision },
    );
    if (!result.ok) {
      ctx.announce(result.reason);
      return;
    }
    if (!ctx.updateDocument) {
      ctx.announce('Shape Builder is unavailable in this editor surface.');
      return;
    }
    try {
      ctx.beginTransaction();
      ctx.updateDocument(() => result.doc);
      ctx.commitTransaction();
    } catch (error) {
      ctx.abortTransaction();
      ctx.announce(
        error instanceof Error ? error.message : 'Shape Builder could not commit safely.',
      );
      return;
    }
    // Select the committed result through the single-id primitives. The
    // ref-based multi-select API filters against the render-synced document
    // state, which does not yet contain nodes created earlier in this same
    // tick, so it would silently drop the new result ids.
    const selectedResultIds = result.selectedNodeIds;
    if (selectedResultIds.length === 0) {
      ctx.setSelection(null);
    } else {
      ctx.setSelection(selectedResultIds[0]!);
      for (const nodeId of selectedResultIds.slice(1)) ctx.toggleSelection(nodeId, true);
    }
    ctx.setDraft(null);
    ctx.announceOperation(
      `Shape Builder ${action}`,
      action === 'create'
        ? 'Created an editable result and retained the source layers.'
        : `${result.createdNodeIds.length} result${result.createdNodeIds.length === 1 ? '' : 's'} committed.`,
    );
    this.resetState();
    ctx.setTool('select');
  }

  private applyFaceSelection(face: ShapeBuilderFace, toggle: boolean): void {
    if (toggle && this.selectedFaceIds.has(face.id)) this.selectedFaceIds.delete(face.id);
    else this.selectedFaceIds.add(face.id);
  }

  private cancelGesture(ctx: ToolContext, message: string): void {
    if (this.gesturePointerId >= 0) ctx.releasePointerCapture(this.gesturePointerId);
    this.selectedFaceIds = new Set(this.selectionBeforeGesture);
    this.gesturePointerId = -1;
    this.gestureModel = null;
    this.gesturePath = [];
    this.gestureVisited.clear();
    this.gestureDragging = false;
    this.hoveredFaceId = null;
    ctx.announce(message);
    this.publish(ctx);
  }

  private getModel(ctx: ToolContext): ShapeBuilderModel {
    const selectionKey = ctx.selection.join('|');
    if (this.model && this.modelDoc === ctx.document && this.modelSelectionKey === selectionKey) {
      return this.model;
    }
    if (this.model && (this.modelSelectionKey !== selectionKey || this.modelDoc !== ctx.document)) {
      this.selectedFaceIds.clear();
      this.hoveredFaceId = null;
    }
    this.model = buildShapeBuilderModel(ctx.document, ctx.selection);
    this.modelDoc = ctx.document;
    this.modelSelectionKey = selectionKey;
    return this.model;
  }

  private publish(ctx: ToolContext, providedModel?: ShapeBuilderModel): void {
    const model = providedModel ?? this.gestureModel ?? this.getModel(ctx);
    const draft: ShapeBuilderDraft = {
      kind: 'shape-builder',
      revision: model.revision,
      hoveredFaceId: this.hoveredFaceId,
      selectedFaceIds: [...this.selectedFaceIds],
      sweep: [...this.gesturePath],
      status: model.status,
      message: model.message,
    };
    ctx.setDraft(draft);
  }

  private resetState(): void {
    this.model = null;
    this.modelDoc = null;
    this.modelSelectionKey = '';
    this.selectedFaceIds.clear();
    this.hoveredFaceId = null;
    this.gesturePointerId = -1;
    this.gestureModel = null;
    this.gesturePath = [];
    this.gestureVisited.clear();
    this.gestureDragging = false;
    this.selectionBeforeGesture.clear();
  }
}
