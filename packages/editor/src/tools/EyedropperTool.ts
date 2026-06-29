/**
 * EyedropperTool — pick a color from the canvas or screen.
 *
 * Uses the EyeDropper API (Chromium) when available, falling back to
 * canvas pixel reading via getImageData.
 *
 * Research basis: MDN EyeDropper API, Figma eyedropper (I).
 */
import type { Color } from '@strata/engine';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

declare class EyeDropper {
  open(): Promise<{ sRGBHex: string }>;
}

export class EyedropperTool extends BaseTool {
  id = 'eyedropper' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const sel = ctx.selection;
    if (sel.length === 0) return { consumed: true };

    const hasAPI = typeof EyeDropper !== 'undefined';

    if (hasAPI) {
      const dropper = new EyeDropper();
      dropper
        .open()
        .then((result: { sRGBHex: string }) => {
          const color = this.hexToColor(result.sRGBHex);
          for (const id of sel) {
            ctx.updateNode(id, (n) => ({ ...n, fill: color }));
          }
        })
        .catch(() => {});
    } else if (ctx.canvasElement) {
      const canvas = ctx.canvasElement;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const pixel = canvas.getContext('2d')?.getImageData(x, y, 1, 1).data;
      if (pixel) {
        const color: Color = [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
        for (const id of sel) {
          ctx.updateNode(id, (n) => ({ ...n, fill: color }));
        }
      }
    }

    return { consumed: true };
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape') {
      ctx.announce('Eyedropper cancelled');
      return true;
    }
    return false;
  }

  private hexToColor(hex: string): Color {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      255,
    ] as Color;
  }
}
