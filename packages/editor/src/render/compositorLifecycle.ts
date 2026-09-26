import { type CompositorBackend, createCompositorBackend } from '@varve/compositor';
import { setCompositorDiagnostics } from './compositorDiagnosticsStore';

interface CompositorLifecycleHandlers {
  onReady: (backend: CompositorBackend) => void;
  onDispose: () => void;
  onRedraw: (reason: 'compositor-init' | 'gpu-device-lost') => void;
  onFallback: (reason: string) => void;
}

/** Own the asynchronous backend selection and prevent a late init from reviving an old canvas. */
export function startCanvasCompositor(
  canvas: HTMLCanvasElement,
  preferWebGpu: boolean,
  handlers: CompositorLifecycleHandlers,
): () => void {
  let disposed = false;
  let backend: CompositorBackend | null = null;

  void createCompositorBackend(canvas, { preferWebGpu })
    .then(({ backend: selected, capabilities }) => {
      if (disposed) {
        selected.destroy();
        return;
      }
      backend = selected;
      const publishDiagnostics = () => {
        const diagnostics = selected.getDiagnostics?.();
        if (!diagnostics) return;
        setCompositorDiagnostics(diagnostics);
      };
      if (selected.id === 'webgpu') {
        selected.onDeviceLost = async () => {
          if (disposed) return;
          publishDiagnostics();
          handlers.onRedraw('gpu-device-lost');
        };
        // A successful automatic recovery rebuilds every device-owned
        // resource; republish so the status flips from "GPU lost" back to
        // the live backend truth. No forced redraw: the canvas holds correct
        // Canvas2D pixels, and the next frame resumes GPU drawing.
        selected.onRecovered = () => {
          if (disposed) return;
          publishDiagnostics();
        };
      }
      handlers.onReady(selected);
      publishDiagnostics();
      if (preferWebGpu && selected.id !== 'webgpu') {
        handlers.onFallback(capabilities.webgpuReason ?? 'WebGPU unavailable');
      }
      handlers.onRedraw('compositor-init');
    })
    .catch(() => {
      if (disposed) return;
      setCompositorDiagnostics({
        backendId: 'canvas2d',
        gpuActive: false,
        vertexPoolEntries: 0,
        bundleCacheEntries: 0,
        lastFrameVertexBytes: 0,
        adapterIsFallback: false,
        fatalError: 'Canvas compositor initialization failed',
      });
    });

  return () => {
    disposed = true;
    backend?.destroy();
    handlers.onDispose();
    setCompositorDiagnostics(null);
  };
}
