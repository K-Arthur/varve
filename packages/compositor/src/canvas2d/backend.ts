/**
 * Canvas2D compositor backend — wraps replayIr.
 */
import { type RenderItem, type ReplayTarget, replayIr } from '@varve/engine';
import { computeFloatingOrigin } from '@varve/shared';
import type {
  CompositorBackend,
  CompositorColorOptions,
  CompositorDiagnostics,
  CompositorFrame,
} from '../types';

/** Canvas surface accepted by the 2D backend (main canvas or offscreen overlay). */
export type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;

export class Canvas2DBackend implements CompositorBackend {
  readonly id = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private dpr = 1;
  async init(canvas: CanvasSurface): Promise<void> {
    this.dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('Canvas2D context unavailable');
    this.ctx = ctx;
  }

  beginFrame(frame: CompositorFrame, opts?: { applyCamera?: boolean; clear?: boolean }): void {
    if (!this.ctx) return;
    this.dpr = window.devicePixelRatio || 1;
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

  drawVectorItems(items: RenderItem[], colorOptions?: CompositorColorOptions): void {
    if (!this.ctx || items.length === 0) return;
    // Always replay: immediate-mode canvas is cleared each frame; skipping draws
    // without a persistent backing store would blank the canvas on cache hits.
    replayIr(
      this.ctx as unknown as ReplayTarget,
      items,
      undefined,
      undefined,
      undefined,
      colorOptions,
    );
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

  getDiagnostics(): CompositorDiagnostics {
    return {
      backendId: 'canvas2d' as const,
      gpuActive: false,
      vertexPoolEntries: 0,
      bundleCacheEntries: 0,
      lastFrameVertexBytes: 0,
      adapterIsFallback: false,
    };
  }

  invalidateTiles(_prefix?: string): void {
    // Immediate-mode canvas; no persistent tiles to invalidate.
  }

  private applyCamera(frame: CompositorFrame): void {
    if (!this.ctx) return;
    const { camera, viewport } = frame;
    // Same composition as applyCameraTransform, but WITHOUT setTransform —
    // beginFrame already applied DPR via setTransform; calling
    // applyCameraTransform would reset it.
    const origin = computeFloatingOrigin(camera, viewport);
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    const r = camera.rotation ?? 0;
    this.ctx.translate(camera.pan.x, camera.pan.y);
    this.ctx.translate(cx, cy);
    if (r !== 0) this.ctx.rotate(r);
    this.ctx.translate(-cx, -cy);
    this.ctx.scale(camera.zoom, camera.zoom);
    // Origin is currently semantic zero. Keep this call at the backend seam
    // so a future geometry-rebasing implementation can update both together.
    this.ctx.translate(-origin[0], -origin[1]);
  }
}
