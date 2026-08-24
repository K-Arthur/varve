import type {
  CursorSpec,
  GestureResult,
  PixelProbe,
  Tool,
  ToolContext,
  ToolCursorState,
} from './types';

/** Persistent canvas sampler used by the Pixel Info tool. */
export class PixelProbeTool implements Tool {
  id = 'pixelProbe' as const;

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  onActivate(ctx: ToolContext): void {
    ctx.setPixelProbe?.(null);
  }

  onDeactivate(ctx: ToolContext): void {
    ctx.setPixelProbe?.(null);
  }

  onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    this.sample(e, ctx, false);
  }

  onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    this.sample(e, ctx, true);
    return { consumed: true };
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key !== 'Escape') return false;
    ctx.setPixelProbe?.(null);
    ctx.announce('Pixel probe cleared');
    return true;
  }

  private sample(e: PointerEvent, ctx: ToolContext, announce: boolean): void {
    const canvas = ctx.canvasElement;
    const setProbe = ctx.setPixelProbe;
    if (!canvas || !setProbe) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((e.clientX - rect.left) * scaleX)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((e.clientY - rect.top) * scaleY)));
    const pixel = canvas.getContext('2d')?.getImageData(x, y, 1, 1).data;
    if (!pixel) return;
    const probe: PixelProbe = {
      screenX: e.clientX - rect.left,
      screenY: e.clientY - rect.top,
      worldX: ctx.canvasToWorld(e.clientX, e.clientY).x,
      worldY: ctx.canvasToWorld(e.clientX, e.clientY).y,
      red: pixel[0]!,
      green: pixel[1]!,
      blue: pixel[2]!,
      alpha: pixel[3]!,
      hex: `#${[pixel[0], pixel[1], pixel[2]]
        .map((value) => value!.toString(16).padStart(2, '0'))
        .join('')}`,
    };
    setProbe(probe);
    if (announce) ctx.announce(`Pixel ${probe.hex}, alpha ${probe.alpha}`);
  }
}
