/**
 * SpotHealTool — click-to-fix tool for small blemishes.
 *
 * Click on a blemish and the tool auto-selects a source region from nearby
 * clean area using patch matching within a search radius.
 *
 * Research basis: Photoshop Spot Healing Brush, GIMP Heal selection.
 *                 Content-aware fill (PatchMatch algorithm).
 */
import { createBrushMask, spotHeal } from '@strata/engine';
import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

interface SpotHealOptions {
  brushSize: number;
  type: 'content-aware' | 'proximity-match';
}

export class SpotHealTool extends BaseTool {
  id = 'spotHeal' as const;

  private options: SpotHealOptions = {
    brushSize: 20,
    type: 'content-aware',
  };

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): { consumed: boolean; captured?: boolean } {
    const canvas = ctx.canvasElement;
    if (!canvas) return { consumed: false };

    const world = ctx.canvasToWorld(e.clientX, e.clientY);

    ctx.beginTransaction();

    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) {
      ctx.abortTransaction();
      return { consumed: false };
    }

    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const imageData = canvasCtx.getImageData(0, 0, canvasW, canvasH);

    const r = Math.floor(this.options.brushSize / 2);
    const result = spotHeal(imageData, Math.round(world.x), Math.round(world.y), r);

    canvasCtx.putImageData(result, 0, 0);

    ctx.commitTransaction();
    ctx.announce('Spot healed');
    return { consumed: true };
  }

  setOptions(opts: Partial<SpotHealOptions>): void {
    Object.assign(this.options, opts);
  }
}
