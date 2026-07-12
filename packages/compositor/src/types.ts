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

export interface CompositorBeginFrameOptions {
  /** Apply camera transform (pan/zoom). Default true. */
  applyCamera?: boolean;
  /** Clear the viewport before drawing. Default true. */
  clear?: boolean;
}

/** Runtime diagnostics exposed to the editor status bar (non-blocking reads). */
export interface CompositorDiagnostics {
  backendId: CompositorBackendId;
  gpuActive: boolean;
  vertexPoolEntries: number;
  bundleCacheEntries: number;
  lastFrameVertexBytes: number;
  adapterIsFallback: boolean;
  /** Shader module + pipeline compilation time during init, in ms. Not tracked by Canvas2DBackend. */
  pipelineInitMs?: number;
  /**
   * True once `GPUDevice.lost` has resolved for a backend that previously
   * had a working device. Distinct from `!gpuActive` on its own: a browser
   * `<canvas>` element's context type (`webgpu` vs `2d`) can't be changed
   * after the first `getContext()` call, so losing the device mid-session
   * leaves the visible canvas with no working rendering path at all (not
   * even a Canvas2D fallback) until the page/canvas element is reloaded —
   * this needs a distinct, actionable UI message rather than being folded
   * into the normal "(cpu)" fallback label, which implies a working
   * degraded mode.
   */
  deviceLost?: boolean;
}

export interface CompositorBackend {
  readonly id: CompositorBackendId;
  init(canvas: HTMLCanvasElement): Promise<void>;
  beginFrame(frame: CompositorFrame, opts?: CompositorBeginFrameOptions): void;
  drawVectorItems(items: RenderItem[]): void;
  compositeRasterLayer(id: string, bitmap: ImageBitmap, transform: Affine, blendMode: string): void;
  endFrame(): void;
  destroy(): void;
  onDeviceLost?: () => Promise<void>;
  /** Optional perf snapshot; backends without GPU metrics omit this. */
  getDiagnostics?(): CompositorDiagnostics;
}

export interface CompositorOptions {
  preferWebGpu?: boolean;
}
