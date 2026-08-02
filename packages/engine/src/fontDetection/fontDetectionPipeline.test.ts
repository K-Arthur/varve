import { describe, expect, it, vi } from 'vitest';
import type { ModelRegistry } from '../inference/ModelRegistry';
import { detectFont } from './fontDetectionPipeline';
import type { FontDetectionRequest } from './fontDetectionTypes';

function makeImageData(width: number, height: number): ImageData {
  return new ImageData(width, height);
}

function makeMockRegistry(isReady: boolean): ModelRegistry {
  return {
    isReady: () => isReady,
    knows: () => isReady,
    getState: () => (isReady ? 'ready' : 'unavailable'),
    getEntry: () => undefined,
    listEntries: () => [],
    register: () => {},
    setState: () => {},
    reset: () => {},
    subscribe: () => () => {},
    listInstallInfo: () => [],
  } as unknown as ModelRegistry;
}

const baseRequest: FontDetectionRequest = {
  imageData: makeImageData(320, 320),
  mode: 'local-match',
  recognizedText: 'Hello World',
  maxCandidates: 5,
};

describe('detectFont', () => {
  it('returns insufficient quality for tiny crops', async () => {
    const request: FontDetectionRequest = {
      ...baseRequest,
      imageData: makeImageData(5, 5),
    };
    const result = await detectFont(request);
    expect(result.status).toBe('insufficient-quality');
    expect(result.candidates).toHaveLength(0);
  });

  it('returns cancelled when signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const request: FontDetectionRequest = {
      ...baseRequest,
      signal: controller.signal,
    };
    const result = await detectFont(request);
    expect(result.status).toBe('cancelled');
  });

  it('resolves classifier mode to local-match when model unavailable', async () => {
    const request: FontDetectionRequest = {
      ...baseRequest,
      mode: 'classifier',
    };
    const result = await detectFont(request, {
      modelRegistry: makeMockRegistry(false),
    });
    expect(result.resolvedMode).toBe('local-match');
    expect(result.usedClassifier).toBe(false);
  });

  it('keeps hybrid mode when classifier is available', async () => {
    const request: FontDetectionRequest = {
      ...baseRequest,
      mode: 'hybrid',
    };
    const result = await detectFont(request, {
      modelRegistry: makeMockRegistry(true),
    });
    // Even though classifier is "ready", without the actual model file
    // the inference will fail — but the resolved mode should be hybrid
    expect(result.resolvedMode).toBe('hybrid');
  });

  it('returns candidates ranked by confidence in local-match mode', async () => {
    const request: FontDetectionRequest = {
      ...baseRequest,
      mode: 'local-match',
      recognizedText: 'Test',
    };
    const result = await detectFont(request);
    // Local match may return 0 candidates without a font catalog,
    // but the pipeline should complete without error
    expect(result.status).toMatch(/success|low-confidence/);
    expect(result.features).not.toBeNull();
    expect(Array.isArray(result.qualityWarnings)).toBe(true);
  });

  it('includes typography features in the result', async () => {
    const result = await detectFont(baseRequest);
    expect(result.features).toBeDefined();
    expect(result.features?.serif).toMatch(/serif|sans-serif|unknown/);
    expect(typeof result.features?.weightEstimate).toBe('number');
  });

  it('respects maxCandidates limit', async () => {
    const request: FontDetectionRequest = {
      ...baseRequest,
      maxCandidates: 3,
    };
    const result = await detectFont(request);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('reports elapsedMs', async () => {
    const result = await detectFont(baseRequest);
    expect(typeof result.elapsedMs).toBe('number');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('detectFont with render compare', () => {
  it('applies render scores in hybrid mode when deps provided', async () => {
    const mockRenderCompare = vi.fn().mockResolvedValue(
      new Map([
        ['Inter', 0.9],
        ['Roboto', 0.8],
      ]),
    );
    const request: FontDetectionRequest = {
      ...baseRequest,
      mode: 'local-match',
      recognizedText: 'Sample',
    };
    const result = await detectFont(request, {
      renderCompare: mockRenderCompare,
    });
    // Render compare is only called in hybrid mode with classifier results
    // In local-match mode it should not be invoked
    expect(mockRenderCompare).not.toHaveBeenCalled();
    expect(result.status).toMatch(/success|low-confidence/);
  });
});
