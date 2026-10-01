import { describe, expect, it } from 'vitest';
import { resolveRendererAttribution } from './rendererAttribution';

const diagnostics = (overrides: Record<string, unknown> = {}) =>
  ({
    backendId: 'webgl2',
    gpuActive: true,
    vertexPoolEntries: 0,
    bundleCacheEntries: 0,
    lastFrameVertexBytes: 0,
    adapterIsFallback: false,
    ...overrides,
  }) as import('@varve/compositor').CompositorDiagnostics;

describe('actual renderer attribution', () => {
  it('reports Canvas2D worker output independently of the requested compositor', () => {
    expect(
      resolveRendererAttribution({
        diagnostics: diagnostics({ requestedRenderer: 'webgl2', lastFrameGpuItems: 0 }),
        structural: false,
        workerBitmapPresented: true,
      }),
    ).toMatchObject({ actualDrawingPath: 'canvas2d-worker', requestedRenderer: 'webgl2' });
  });

  it('reports mixed GPU and Canvas2D output with measured upload and copy costs', () => {
    expect(
      resolveRendererAttribution({
        diagnostics: diagnostics({
          lastFrameGpuItems: 8,
          lastFrameFallbackCanvasItems: 3,
          lastFrameTextureUploads: 1,
          lastFrameSubmitCpuMs: 2.5,
          lastFrameBlitCpuMs: 0.8,
          gpuTextureBytes: 4_194_304,
        }),
        structural: false,
        workerBitmapPresented: false,
      }),
    ).toMatchObject({
      actualDrawingPath: 'webgl2-mixed',
      gpuSubmittedItems: 8,
      fallbackCanvasItems: 3,
      textureUploads: 1,
      gpuSubmitCpuMs: 2.5,
      gpuBlitCpuMs: 0.8,
      gpuTextureBytes: 4_194_304,
    });
  });

  it('does not report a GPU renderer as active when no items were submitted', () => {
    expect(
      resolveRendererAttribution({
        diagnostics: diagnostics({ lastFrameGpuItems: 0 }),
        structural: false,
        workerBitmapPresented: false,
      }).actualDrawingPath,
    ).toBe('canvas2d-main');
  });
});
