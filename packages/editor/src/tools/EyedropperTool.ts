/**
 * EyedropperTool — pick a color from the canvas or screen.
 *
 * Uses the EyeDropper API (Chromium) when available, falling back to
 * canvas pixel reading via getImageData. On engines without the EyeDropper
 * API (WebKitGTK, Firefox, Safari) only in-canvas pixels can be sampled;
 * the fallback reports that honestly instead of failing silently.
 *
 * Research basis: MDN EyeDropper API, Figma eyedropper (I).
 */
import type { ManagedColor } from '@varve/scene';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

declare class EyeDropper {
  open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>;
}

export class EyedropperTool extends BaseTool {
  id = 'eyedropper' as const;

  /** Cancels an in-flight EyeDropper prompt when Escape is pressed. */
  private activeController: AbortController | null = null;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const sel = ctx.selection;
    if (sel.length === 0) {
      ctx.announce('Select a layer to apply the sampled color');
      return { consumed: true };
    }

    const hasAPI = typeof EyeDropper !== 'undefined';

    if (hasAPI) {
      const controller = new AbortController();
      this.activeController = controller;
      const dropper = new EyeDropper();
      dropper
        .open({ signal: controller.signal })
        .then((result: { sRGBHex: string }) => {
          if (controller.signal.aborted) return;
          const color = this.hexToColor(result.sRGBHex);
          for (const id of sel) {
            ctx.updateNode(id, (n) => ({ ...n, fill: color }));
          }
          ctx.announce('Color sampled and applied to fill');
        })
        .catch((err: unknown) => {
          // AbortError from Escape or a user dismissal — expected, not an error.
          // Anything else (unsupported build, blocked prompt) must not be silent.
          if (err instanceof DOMException && err.name === 'AbortError') return;
          ctx.announce('Screen sampling is unavailable here');
        })
        .finally(() => {
          if (this.activeController === controller) this.activeController = null;
        });
    } else if (ctx.canvasElement) {
      let sampled: ManagedColor | null = null;
      const canvas = ctx.canvasElement;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) {
        // The canvas's context type is owned by something else (WebGPU, etc.).
        ctx.announce('Canvas sampling is unavailable for this pixel');
        return { consumed: true };
      }
      try {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        const pixel = ctx2d.getImageData(x, y, 1, 1).data;
        if (pixel) {
          sampled = {
            space: 'rgb',
            r: pixel[0] as number,
            g: pixel[1] as number,
            b: pixel[2] as number,
            a: pixel[3] as number,
          };
        }
      } catch {
        // getImageData throws SecurityError on a tainted canvas.
        ctx.announce('Canvas sampling is unavailable for this pixel');
        return { consumed: true };
      }
      if (sampled) {
        const color = sampled;
        for (const id of sel) {
          ctx.updateNode(id, (n) => ({ ...n, fill: color }));
        }
        ctx.announce('Color sampled and applied to fill');
      }
    }

    return { consumed: true };
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.activeController?.abort();
      ctx.announce('Eyedropper cancelled');
      return true;
    }
    return false;
  }

  private hexToColor(hex: string): ManagedColor {
    const h = hex.replace('#', '');
    return {
      space: 'rgb' as const,
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 255,
    };
  }
}
