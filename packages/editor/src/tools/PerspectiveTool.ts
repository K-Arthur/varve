/**
 * Perspective (four-corner) tool for image fills.
 *
 * Shows four draggable corner handles on the selected image node. Dragging
 * a corner updates `fill.perspective.quad` (node-local [TL,TR,BR,BL] as
 * `[x,y]` tuples). Committing writes the quad into the document model in
 * one undo entry; Escape cancels and restores the previous state.
 */

import type { NodeId, PerspectiveQuad } from '@varve/scene';
import { isImageShape, isPerspectiveQuadValid, nodeLocalBounds } from '@varve/scene';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

/** Tool-visible state consumed by PerspectiveOverlay. */
export interface PerspectiveState {
  nodeId: NodeId;
  /** Current quad in node-local coords (mutable snapshot). */
  quad: PerspectiveQuad;
  /** Node-local dimensions for clamp/reference. */
  boxW: number;
  boxH: number;
}

/** Mutable point type used during drag. */
type MutablePoint = [number, number];

export class PerspectiveTool extends BaseTool {
  readonly id = 'perspective' as const;

  private state: PerspectiveState | null = null;
  private originalQuad: PerspectiveQuad | null = null;
  private commitHandler: ((state: PerspectiveState) => void) | null = null;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  get current(): Readonly<PerspectiveState> | null {
    return this.state;
  }

  /** Called by useToolManagerSync when the user confirms (Enter/Done). */
  setCommitHandler(handler: ((state: PerspectiveState) => void) | null): void {
    this.commitHandler = handler;
  }

  commit(ctx: ToolContext): void {
    if (this.state && !isPerspectiveQuadValid(this.state.quad)) {
      ctx.announce('Perspective corners must form a convex quadrilateral');
      return;
    }
    if (this.state && this.commitHandler) {
      this.commitHandler(this.state);
      ctx.announce('Perspective applied');
    }
    ctx.setTool('select');
  }

  cancel(ctx: ToolContext): void {
    this.state = null;
    this.originalQuad = null;
    ctx.announce('Perspective cancelled');
    ctx.setTool('select');
  }

  /** Update one corner from the overlay drag. */
  setCorner(corner: 0 | 1 | 2 | 3, x: number, y: number): void {
    if (!this.state) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const quad = [...this.state.quad] as MutablePoint[];
    quad[corner] = [x, y];
    const nextQuad = quad as unknown as PerspectiveQuad;
    if (!isPerspectiveQuadValid(nextQuad)) return;
    this.state = { ...this.state, quad: nextQuad };
    this.notify();
  }

  /** Restore the quad to the snapshot taken on activate. */
  restoreOriginal(): void {
    if (!this.state || !this.originalQuad) return;
    this.state = { ...this.state, quad: cloneQuad(this.originalQuad) };
    this.notify();
  }

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'default' };
  }

  // ── BaseTool overrides ──────────────────────────────────────────────────

  override onActivate(ctx: ToolContext): void {
    this.state = null;
    this.originalQuad = null;

    if (ctx.selection.length !== 1) {
      ctx.announce('Select one image to apply perspective');
      ctx.setTool('select');
      return;
    }
    const id = ctx.selection[0] ?? null;
    if (!id) {
      ctx.announce('Select an image to apply perspective');
      ctx.setTool('select');
      return;
    }
    const node = ctx.getNode(id);
    if (node?.kind !== 'shape' || !isImageShape(node)) {
      ctx.announce('Perspective requires a shape with an image fill');
      ctx.setTool('select');
      return;
    }
    const bounds = nodeLocalBounds(node, ctx.document);
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
      ctx.announce('Perspective requires a shape with measurable bounds');
      ctx.setTool('select');
      return;
    }

    const imageFill = (node.fills ?? []).find(
      (f: { type: string }) => f.type === 'image',
    )?.image as { perspective?: { quad: PerspectiveQuad } } | undefined;

    const persistedQuad = imageFill?.perspective?.quad;
    const currentQuad: PerspectiveQuad =
      persistedQuad && isPerspectiveQuadValid(persistedQuad)
        ? cloneQuad(persistedQuad)
        : [
            [bounds.x, bounds.y],
            [bounds.x + bounds.w, bounds.y],
            [bounds.x + bounds.w, bounds.y + bounds.h],
            [bounds.x, bounds.y + bounds.h],
          ];

    this.state = {
      nodeId: id,
      quad: currentQuad,
      boxW: bounds.w,
      boxH: bounds.h,
    };
    this.originalQuad = cloneQuad(currentQuad);
    this.notify();
    ctx.announce('Perspective: drag corners to distort. Enter to confirm, Escape to cancel.');
  }

  override onDeactivate(): void {
    this.state = null;
    this.originalQuad = null;
    this.notify();
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Enter') {
      this.commit(ctx);
      return true;
    }
    if (e.key === 'Escape') {
      this.cancel(ctx);
      return true;
    }
    return false;
  }
}

function cloneQuad(quad: PerspectiveQuad): PerspectiveQuad {
  return quad.map(([x, y]) => [x, y] as [number, number]) as PerspectiveQuad;
}
