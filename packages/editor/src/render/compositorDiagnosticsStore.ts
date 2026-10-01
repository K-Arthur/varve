/**
 * Non-blocking compositor diagnostics for StatusBar (useSyncExternalStore).
 */
import type { CompositorDiagnostics } from '@varve/compositor';

let snapshot: CompositorDiagnostics | null = null;
const listeners = new Set<() => void>();

export function setCompositorDiagnostics(next: CompositorDiagnostics | null): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeCompositorDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCompositorDiagnosticsSnapshot(): CompositorDiagnostics | null {
  return snapshot;
}

export function formatCompositorStatus(diagnostics: CompositorDiagnostics): {
  label: string;
  detail: string;
  warning: boolean;
} {
  if (diagnostics.fatalError) {
    return {
      label: 'Renderer unavailable',
      detail: 'The canvas could not initialize. Reload the document tab to retry.',
      warning: true,
    };
  }
  if (diagnostics.deviceLost) {
    if (diagnostics.backendId === 'webgl2') {
      return {
        label: 'WebGL2 lost · Canvas2D',
        detail:
          'The WebGL2 context was lost. Canvas2D is drawing while bounded recovery is attempted.',
        warning: true,
      };
    }
    return {
      label: 'GPU lost · Canvas2D',
      detail: 'The WebGPU device was lost. Canvas2D is drawing; reload to retry WebGPU.',
      warning: true,
    };
  }
  if (diagnostics.initFailureReason) {
    const requested =
      diagnostics.requestedRenderer === 'webgl2' || diagnostics.backendId === 'webgl2'
        ? 'WebGL2'
        : 'WebGPU';
    return {
      label: `${requested} unavailable · Canvas2D`,
      detail: `${requested} preference fell back to Canvas2D: ${diagnostics.initFailureReason}.`,
      warning: true,
    };
  }
  if (diagnostics.backendId === 'webgpu' && diagnostics.gpuActive) {
    if (diagnostics.lastFrameGpuItems === undefined) {
      return {
        label: 'WebGPU ready',
        detail: 'WebGPU initialized; no completed frame has reported GPU drawing yet.',
        warning: false,
      };
    }
    if (diagnostics.lastFrameGpuItems > 0) {
      return {
        label: 'WebGPU + Canvas2D',
        detail: `${diagnostics.lastFrameGpuItems} eligible item(s) were submitted to WebGPU in the last frame. Other content may use Canvas2D.`,
        warning: false,
      };
    }
    return {
      label: 'Canvas2D · GPU ready',
      detail: 'WebGPU is ready, but the last frame used Canvas2D or worker replay.',
      warning: false,
    };
  }
  if (diagnostics.backendId === 'webgl2' && diagnostics.gpuActive) {
    const submitted = diagnostics.lastFrameGpuItems ?? 0;
    return {
      label: submitted > 0 ? 'WebGL2 · experimental' : 'WebGL2 ready · experimental',
      detail:
        submitted > 0
          ? `${submitted} eligible item(s) were submitted to WebGL2 in the last frame. Hardware execution is not inferred; other artwork may use Canvas2D.`
          : 'WebGL2 initialized; the last frame did not report eligible drawing.',
      warning: false,
    };
  }
  return {
    label: diagnostics.backendId === 'canvas2d' ? 'Canvas2D' : diagnostics.backendId,
    detail: 'Active canvas renderer. Browser or webview hardware acceleration is not inferred.',
    warning: false,
  };
}
