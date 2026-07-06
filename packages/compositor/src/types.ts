/**
 * Compositor types — backend router for mixed raster + vector replay.
 */
import type { RenderItem } from '@strata/engine';
import type { Affine, Camera, Viewport } from '@strata/shared';

export type CompositorBackendId = 'canvas2d' | 'webgpu' | 'native';

export interface CompositorCapabilities {
  webgpu: boolean;
  webgpuReason?: string;
  isFallbackAdapter?: boolean;
}

export interface CompositorFrame {
  items: RenderItem[];
  camera: Camera;
  viewport: Viewport;
  docVersion: number;
}

export interface CompositorBackend {
  readonly id: CompositorBackendId;
  init(canvas: HTMLCanvasElement): Promise<void>;
  beginFrame(frame: CompositorFrame, opts?: { applyCamera?: boolean }): void;
  drawVectorItems(items: RenderItem[]): void;
  compositeRasterLayer(
    id: string,
    bitmap: ImageBitmap,
    transform: Affine,
    blendMode: string,
  ): void;
  endFrame(): void;
  destroy(): void;
  onDeviceLost?: () => Promise<void>;
}

export interface CompositorOptions {
  preferWebGpu?: boolean;
}
