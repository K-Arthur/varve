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
  type AreaSelectionSettings,
  combineAreaSelections,
  createAreaSelection,
  DEFAULT_AREA_SELECTION_SETTINGS,
} from '@varve/engine';
import { BaseTool } from './BaseTool';
import { normalizeMarqueeRect } from './marqueeGeometry';
import { selectionOperationFromModifiers } from './selectionOperations';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export class MarqueeTool extends BaseTool {
  id: 'marquee' | 'ellipseMarquee';

  private readonly shapeKind: 'rectangle' | 'ellipse';

  private operation: AreaSelectionOperation = 'replace';
  private gestureSettings: AreaSelectionSettings = { ...DEFAULT_AREA_SELECTION_SETTINGS };

  constructor(shapeKind: 'rectangle' | 'ellipse' = 'rectangle') {
    super();
    this.shapeKind = shapeKind;
    this.id = shapeKind === 'ellipse' ? 'ellipseMarquee' : 'marquee';
  }

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair', fallback: 'crosshair' };
  }

  override onActivate(ctx: ToolContext): void {
    // Keep the selected raster target available for painting and mask
    // commands. SelectionOverlay hides node handles while this tool is active,
    // so the two domains are never presented as one visual selection.
    ctx.setDraft(null);
  }

  override onDeactivate(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    this.gestureSettings = {
      ...DEFAULT_AREA_SELECTION_SETTINGS,
      ...(ctx.areaSelectionSettings ?? {}),
    };
    this.operation =
      e.shiftKey || e.altKey ? selectionOperationFromModifiers(e) : this.gestureSettings.operation;
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
    const rect = this.computeSelectionRect();
    if (!rect || rect.w <= 0 || rect.h <= 0) return;

    const incoming = createAreaSelection(
      {
        kind: this.shapeKind,
        ...rect,
        feather: this.gestureSettings.feather,
        antialias: this.gestureSettings.antialias,
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
      `${this.shapeKind === 'ellipse' ? 'Elliptical' : 'Rectangular'} selection, ${formatSize(rect.w)} by ${formatSize(rect.h)} document pixels`,
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
    const rect = this.computeSelectionRect();
    if (!rect) {
      ctx.setDraft(null);
      return;
    }
    ctx.setDraft({
      kind: this.shapeKind === 'ellipse' ? 'ellipse' : 'rect',
      ...rect,
      label: `${this.shapeKind === 'ellipse' ? 'Elliptical' : 'Rectangular'} pixel selection`,
    });
  }

  private computeSelectionRect() {
    const raw = normalizeMarqueeRect(this.drag.startWorld, this.drag.currentWorld);
    if (!raw) return null;
    const settings = this.gestureSettings;
    let width = raw.w;
    let height = raw.h;
    if (settings.style === 'fixed-size') {
      width = Math.max(0, settings.fixedWidth);
      height = Math.max(0, settings.fixedHeight);
    } else if (settings.style === 'fixed-ratio') {
      const ratio = Math.max(0.0001, settings.ratio);
      if (raw.w / ratio >= raw.h) {
        width = raw.w;
        height = raw.w / ratio;
      } else {
        height = raw.h;
        width = raw.h * ratio;
      }
    }

    const dx = this.drag.currentWorld.x - this.drag.startWorld.x;
    const dy = this.drag.currentWorld.y - this.drag.startWorld.y;
    if (settings.fromCenter) {
      const sx = dx < 0 ? -1 : 1;
      const sy = dy < 0 ? -1 : 1;
      return {
        x: this.drag.startWorld.x - (width * sx) / 2,
        y: this.drag.startWorld.y - (height * sy) / 2,
        w: width,
        h: height,
      };
    }
    return {
      x: dx < 0 ? this.drag.startWorld.x - width : this.drag.startWorld.x,
      y: dy < 0 ? this.drag.startWorld.y - height : this.drag.startWorld.y,
      w: width,
      h: height,
    };
  }
}

function formatSize(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '');
}
