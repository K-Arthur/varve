/**
 * Compositor types — backend router for mixed raster + vector replay.
 */
import type { RenderItem } from '@varve/engine';
import type { Affine, BlendEvaluationSpace, Camera, Viewport } from '@varve/shared';

export type CompositorBackendId = 'canvas2d' | 'webgpu' | 'webgl2' | 'native';

export interface CompositorCapabilities {
  /** Router: acquired backend; explicit detection: usable at probe time. */
  webgpu: boolean;
  webgpuReason?: string;
  /** WebGL2 context, shader execution, and presentation probe succeeded. */
  webgl2?: boolean;
  webgl2Reason?: string;
  /** Why the requested non-default renderer fell back to Canvas2D. */
  rendererReason?: string;
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
  /**
   * Authoritative "this node's semantics cannot be reproduced by the
   * per-item GPU path" boundary (group blend/isolation/mask/adjustment/
   * filter). The complete node range is preserved on the Canvas2D island
   * even when every leaf item looks GPU-compatible; descendant islands
   * collapse into it. Ignored only if unset.
   */
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

/**
 * Image representation inputs passed through to the Canvas2D replay path.
 * Kept structural so compositor callers do not need to depend on the engine's
 * internal image-cache policy module.
 */
export interface CompositorImagePolicy {
  maxSourceDim?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  intent?: 'interactive' | 'settled-preview' | 'thumbnail' | 'export' | 'print';
  resolveMaxSourceDim?: (request: {
    projectedLongEdge: number;
    sourceWidth?: number;
    sourceHeight?: number;
  }) => number;
}

/** Runtime diagnostics exposed to the editor status bar (non-blocking reads). */
export interface CompositorDiagnostics {
  backendId: CompositorBackendId;
  gpuActive: boolean;
  vertexPoolEntries: number;
  bundleCacheEntries: number;
  lastFrameVertexBytes: number;
  adapterIsFallback: boolean;
  /** Non-Canvas preference that resolved to a Canvas2D fallback. */
  requestedRenderer?: 'webgpu' | 'webgl2';
  /** Fixed, non-identifying reason why a requested GPU backend could not start. */
  initFailureReason?: string;
  /** Canvas presentation itself could not initialize; no fallback is active. */
  fatalError?: string;
  /** Number of items actually submitted to a GPU backend in the last completed frame. */
  lastFrameGpuItems?: number;
  /** Items replayed through the authoritative Canvas2D fallback in the last frame. */
  lastFrameFallbackCanvasItems?: number;
  /** Successfully uploaded image textures in the last frame. */
  lastFrameTextureUploads?: number;
  /** CPU time spent submitting and flushing draw commands, not GPU execution time. */
  lastFrameSubmitCpuMs?: number;
  /** CPU time spent copying the offscreen GPU canvas into the visible Canvas2D. */
  lastFrameBlitCpuMs?: number;
  /** Estimated resident RGBA8 texture bytes for the experimental WebGL2 path. */
  gpuTextureBytes?: number;
  /** Shader module + pipeline compilation time during init, in ms. Not tracked by Canvas2DBackend. */
  pipelineInitMs?: number;
  /**
   * True between `GPUDevice.lost` resolving for a working device and a
   * successful bounded recovery (or exhaustively: two failed attempts). The
   * present canvas stays on Canvas2D throughout, so rendering continues
   * without a remount — `gpuActive` flips false and the StatusBar surfaces a
   * warning. A successful recovery clears this and republishes diagnostics.
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
  drawVectorItems(
    items: RenderItem[],
    colorOptions?: CompositorColorOptions,
    imagePolicy?: CompositorImagePolicy,
  ): void;
  compositeRasterLayer(id: string, bitmap: ImageBitmap, transform: Affine, blendMode: string): void;
  endFrame(): void;
  destroy(): void;
  onDeviceLost?: () => Promise<void>;
  /** Invoked after an automatic in-place device-loss recovery succeeds. */
  onRecovered?: () => void;
  /** Optional perf snapshot; backends without GPU metrics omit this. */
  getDiagnostics?(): CompositorDiagnostics;
}

export interface CompositorOptions {
  preferWebGpu?: boolean;
  renderer?: 'canvas2d' | 'webgpu' | 'webgl2';
}
