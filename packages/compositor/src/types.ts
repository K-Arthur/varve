/**
 * Compositor types — backend router for mixed raster + vector replay.
 */
import type { RenderItem } from '@varve/engine';
import type { Affine, BlendEvaluationSpace, Camera, Viewport } from '@varve/shared';

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
  /** Optional structural metadata. Without it, planning is flat and fail-closed. */
  structure?: RenderStructureNode;
}

/** Minimal render-structure seam used by capability planning. */
export interface RenderStructureNode {
  /** Ordered `CompositorFrame.items` range, end exclusive. */
  itemStart: number;
  itemEnd: number;
  children?: readonly RenderStructureNode[];
  /** Preserve the complete node range when a descendant is unsupported. */
  fallbackBoundary?: boolean;
  fallbackReason?: string;
}

export interface CompositorBeginFrameOptions {
  /** Apply camera transform (pan/zoom). Default true. */
  applyCamera?: boolean;
  /** Clear the viewport before drawing. Default true. */
  clear?: boolean;
}

export interface CompositorColorOptions {
  blendEvaluationSpace?: BlendEvaluationSpace;
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
   * had a working device. After the 2026-07-13 ownership invert, the present
   * canvas stays on Canvas2D, so rendering continues without a remount —
   * `gpuActive` flips to false and the StatusBar surfaces a warning. Reload
   * is only needed if the user wants to re-acquire the GPU adapter.
   */
  deviceLost?: boolean;
  /** Ordered structural fallback telemetry for the most recent frame. */
  fallbackIslandCount?: number;
  fallbackNodeCount?: number;
  fallbackRasterArea?: number;
  fallbackReasons?: Record<string, number>;
}

export interface CompositorBackend {
  readonly id: CompositorBackendId;
  init(canvas: HTMLCanvasElement): Promise<void>;
  beginFrame(frame: CompositorFrame, opts?: CompositorBeginFrameOptions): void;
  drawVectorItems(items: RenderItem[], colorOptions?: CompositorColorOptions): void;
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
