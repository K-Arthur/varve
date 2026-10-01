import type { CompositorDiagnostics } from '@varve/compositor';

export type ActualDrawingPath =
  | 'canvas2d-main'
  | 'canvas2d-structural'
  | 'canvas2d-worker'
  | 'webgpu'
  | 'webgpu-mixed'
  | 'webgl2'
  | 'webgl2-mixed';

export interface RendererAttribution {
  actualDrawingPath: ActualDrawingPath;
  requestedRenderer: 'canvas2d' | 'webgpu' | 'webgl2';
  gpuSubmittedItems: number;
  fallbackCanvasItems: number;
  textureUploads: number;
  gpuSubmitCpuMs: number;
  gpuBlitCpuMs: number;
  gpuTextureBytes: number;
}

/** Attribute the pixels on screen to the selected renderer, not its preference. */
export function resolveRendererAttribution(options: {
  diagnostics: CompositorDiagnostics | null | undefined;
  structural: boolean;
  workerBitmapPresented: boolean;
}): RendererAttribution {
  const diagnostics = options.diagnostics;
  const gpuSubmittedItems = diagnostics?.lastFrameGpuItems ?? 0;
  const fallbackCanvasItems = diagnostics?.lastFrameFallbackCanvasItems ?? 0;
  const backend = diagnostics?.backendId;
  const actualDrawingPath: ActualDrawingPath = options.structural
    ? 'canvas2d-structural'
    : options.workerBitmapPresented
      ? 'canvas2d-worker'
      : backend === 'webgl2' && gpuSubmittedItems > 0
        ? fallbackCanvasItems > 0
          ? 'webgl2-mixed'
          : 'webgl2'
        : backend === 'webgpu' && gpuSubmittedItems > 0
          ? fallbackCanvasItems > 0
            ? 'webgpu-mixed'
            : 'webgpu'
          : 'canvas2d-main';
  const requestedRenderer =
    diagnostics?.requestedRenderer ??
    (backend === 'webgpu' || backend === 'webgl2' ? backend : 'canvas2d');

  return {
    actualDrawingPath,
    requestedRenderer,
    gpuSubmittedItems,
    fallbackCanvasItems,
    textureUploads: diagnostics?.lastFrameTextureUploads ?? 0,
    gpuSubmitCpuMs: diagnostics?.lastFrameSubmitCpuMs ?? 0,
    gpuBlitCpuMs: diagnostics?.lastFrameBlitCpuMs ?? 0,
    gpuTextureBytes: diagnostics?.gpuTextureBytes ?? 0,
  };
}
