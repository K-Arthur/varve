/**
 * Rectangular pixel-area selection.
 *
 * This tool is intentionally separate from SelectTool: SelectTool changes
 * scene-node IDs, while MarqueeTool creates an analytical document-space
 * AreaSelection used by raster operations. It never adds a node id merely
 * because a raster region was drawn.
 */

import {
  type AreaSelectionOperation,
  combineAreaSelections,
  createAreaSelection,
} from '@varve/engine';
import { BaseTool } from './BaseTool';
import { normalizeMarqueeRect } from './marqueeGeometry';
import { selectionOperationFromModifiers } from './selectionOperations';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export class MarqueeTool extends BaseTool {
  id = 'marquee' as const;

  private operation: AreaSelectionOperation = 'replace';

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'crosshair' };
  }

  override onActivate(ctx: ToolContext): void {
    // A pixel-area selection is a different user-facing domain from node
    // selection. Clear node ids on entry so transform handles cannot be
    // mistaken for the raster selection boundary.
    ctx.setSelection(null);
    ctx.setDraft(null);
  }

  override onDeactivate(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    this.operation = selectionOperationFromModifiers(e);
    return super.onPointerDown(e, ctx);
  }

  override onDragStart(ctx: ToolContext): void {
    this.emitDraft(ctx);
  }

  override onDragMove(ctx: ToolContext): void {
    this.emitDraft(ctx);
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const rect = normalizeMarqueeRect(this.drag.startWorld, this.drag.currentWorld);
    if (!rect || rect.w <= 0 || rect.h <= 0) return;

    const incoming = createAreaSelection(
      {
        kind: 'rectangle',
        ...rect,
        feather: 0,
        antialias: false,
      },
      (ctx.areaSelection?.generation ?? 0) + 1,
    );
    if (!incoming || !ctx.setAreaSelection) return;

    const next = combineAreaSelections(
      ctx.areaSelection ?? null,
      incoming,
      this.operation,
      (ctx.areaSelection?.generation ?? 0) + 1,
    );
    ctx.setAreaSelection(next);
    ctx.announce(
      `Rectangular selection, ${formatSize(rect.w)} by ${formatSize(rect.h)} document pixels`,
    );
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key !== 'Escape') return false;
    if (this.drag.kind === 'dragging') {
      this.onDragCancel(ctx);
      return true;
    }
    if (ctx.areaSelection && ctx.setAreaSelection) {
      ctx.setAreaSelection(null);
      ctx.announce('Pixel selection cleared');
      return true;
    }
    return false;
  }

  private emitDraft(ctx: ToolContext): void {
    const rect = normalizeMarqueeRect(this.drag.startWorld, this.drag.currentWorld);
    if (!rect) {
      ctx.setDraft(null);
      return;
    }
    ctx.setDraft({ kind: 'rect', ...rect, label: 'Pixel selection' });
  }
}

function formatSize(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '');
}
