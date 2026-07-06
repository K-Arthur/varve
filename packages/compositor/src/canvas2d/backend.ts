/**
 * Canvas2D compositor backend — wraps replayIr + tile cache.
 */
import { replayIr, type RenderItem, type ReplayTarget } from '@strata/engine';
import type { CompositorBackend, CompositorFrame } from '../types';
import { TileCache } from './tileCache';

export class Canvas2DBackend implements CompositorBackend {
  readonly id = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private readonly tileCache = new TileCache();
  private currentFrame: CompositorFrame | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D context unavailable');
    this.ctx = ctx;
  }

  beginFrame(frame: CompositorFrame, opts?: { applyCamera?: boolean }): void {
    this.currentFrame = frame;
    if (!this.ctx) return;
    const { viewport } = frame;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, viewport.width, viewport.height);
    this.ctx.save();
    if (opts?.applyCamera !== false) {
      this.applyCamera(frame);
    }
  }

  drawVectorItems(items: RenderItem[]): void {
    if (!this.ctx || items.length === 0) return;
    const bucket = TileCache.cameraBucket(this.currentFrame?.camera.zoom ?? 1);
    const hash = `${items.length}:${items[0]?.transform.join(',') ?? ''}`;
    const key = TileCache.tileKey(hash, bucket);
    if (this.tileCache.has(key)) {
      return;
    }
    replayIr(this.ctx as unknown as ReplayTarget, items);
    this.tileCache.touch(key);
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
    this.currentFrame = null;
  }

  destroy(): void {
    this.ctx = null;
    this.tileCache.invalidate();
  }

  invalidateTiles(prefix?: string): void {
    this.tileCache.invalidate(prefix);
  }

  private applyCamera(frame: CompositorFrame): void {
    if (!this.ctx) return;
    const { camera, viewport } = frame;
    this.ctx.translate(viewport.width / 2, viewport.height / 2);
    this.ctx.scale(camera.zoom, camera.zoom);
    this.ctx.translate(-camera.pan.x, -camera.pan.y);
  }
}
