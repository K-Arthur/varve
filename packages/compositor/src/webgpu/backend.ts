/**
 * WebGPU compositor scaffold — falls back to Canvas2D until pipelines land.
 */
import type { CompositorBackend, CompositorFrame } from '../types';
import { Canvas2DBackend } from '../canvas2d/backend';

export class WebGPUBackend implements CompositorBackend {
  readonly id = 'webgpu' as const;
  private fallback: Canvas2DBackend | null = null;
  private deviceLostHandler: (() => Promise<void>) | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.fallback = new Canvas2DBackend();
    await this.fallback.init(canvas);
  }

  beginFrame(frame: CompositorFrame, opts?: { applyCamera?: boolean }): void {
    this.fallback?.beginFrame(frame, opts);
  }

  drawVectorItems(items: import('@strata/engine').RenderItem[]): void {
    this.fallback?.drawVectorItems(items);
  }

  compositeRasterLayer(
    id: string,
    bitmap: ImageBitmap,
    transform: readonly [number, number, number, number, number, number],
    blendMode: string,
  ): void {
    this.fallback?.compositeRasterLayer(id, bitmap, transform, blendMode);
  }

  endFrame(): void {
    this.fallback?.endFrame();
  }

  destroy(): void {
    this.fallback?.destroy();
    this.fallback = null;
  }

  set onDeviceLost(handler: (() => Promise<void>) | undefined) {
    this.deviceLostHandler = handler ?? null;
  }

  /** Register GPUDevice.lost recovery (called when real WebGPU path is active). */
  watchDeviceLost(device: { lost: Promise<unknown> }): void {
    void device.lost.then(async () => {
      if (this.deviceLostHandler) await this.deviceLostHandler();
    });
  }
}
