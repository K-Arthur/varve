/**
 * Canvas2D compositor backend — wraps replayIr.
 */
import { type RenderItem, type ReplayTarget, replayIr } from '@strata/engine';
import type { CompositorBackend, CompositorFrame } from '../types';

export class Canvas2DBackend implements CompositorBackend {
  readonly id = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D context unavailable');
    this.ctx = ctx;
  }

  beginFrame(frame: CompositorFrame, opts?: { applyCamera?: boolean; clear?: boolean }): void {
    if (!this.ctx) return;
    const { viewport } = frame;
    const shouldClear = opts?.clear !== false;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (shouldClear) {
      this.ctx.clearRect(0, 0, viewport.width, viewport.height);
    }
    this.ctx.save();
    if (opts?.applyCamera !== false) {
      this.applyCamera(frame);
    }
  }

  drawVectorItems(items: RenderItem[]): void {
    if (!this.ctx || items.length === 0) return;
    // Always replay: immediate-mode canvas is cleared each frame; skipping draws
    // without a persistent backing store would blank the canvas on cache hits.
    replayIr(this.ctx as unknown as ReplayTarget, items);
  }

  compositeRasterLayer(
    _id: string,
    bitmap: ImageBitmap,
    transform: readonly [number, number, number, number, number, number],
    _blendMode: string,
  ): void {
    if (!this.ctx) return;
    this.ctx.save();
    this.ctx.transform(
      transform[0],
      transform[1],
      transform[2],
      transform[3],
      transform[4],
      transform[5],
    );
    this.ctx.drawImage(bitmap, 0, 0);
    this.ctx.restore();
  }

  endFrame(): void {
    this.ctx?.restore();
  }

  destroy(): void {
    this.ctx = null;
  }

  invalidateTiles(_prefix?: string): void {
    // Immediate-mode canvas; no persistent tiles to invalidate.
  }

  private applyCamera(frame: CompositorFrame): void {
    if (!this.ctx) return;
    const { camera } = frame;
    // Matches @strata/shared/viewport: screen = world * zoom + pan
    this.ctx.translate(camera.pan.x, camera.pan.y);
    this.ctx.scale(camera.zoom, camera.zoom);
  }
}
