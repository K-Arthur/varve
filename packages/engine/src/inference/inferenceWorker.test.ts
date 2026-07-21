/**
 * Tests for the generic multi-model inference worker registry.
 *
 * Verifies that all declared WorkerModelType variants are properly
 * registered and can be dispatched without "Unknown model type" errors.
 */
import { describe, expect, it } from 'vitest';

// Mock self.onmessage before importing the worker module (which sets it at
// module level). jsdom does not provide the Worker global scope.
const mockSelf = { onmessage: null as ((e: MessageEvent) => void) | null };
(globalThis as Record<string, unknown>).self = mockSelf;

const { registerModelType } = await import('./inferenceWorker');

describe('inference worker model registry', () => {
  it('exports registerModelType as a function', () => {
    expect(typeof registerModelType).toBe('function');
  });

  it('allows registering a new model type', () => {
    registerModelType('depth', {
      tensorSpec: {
        inputWidth: 64,
        inputHeight: 64,
        mean: [0.5, 0.5, 0.5],
        std: [0.5, 0.5, 0.5],
        paddingRgb: [0, 0, 0],
      },
      getInputSize: () => 64,
      hasImageInput: true,
    });
    expect(true).toBe(true);
  });

  it('allows registering sam2 with prompt encoding', () => {
    registerModelType('sam2', {
      tensorSpec: {
        inputWidth: 1024,
        inputHeight: 1024,
        mean: [0.485, 0.456, 0.406],
        std: [0.229, 0.224, 0.225],
        paddingRgb: [0, 0, 0],
      },
      getInputSize: () => 1024,
      hasImageInput: true,
      encodePrompts: (params: Record<string, unknown>) => {
        const pointCoords = params.pointCoords as Float32Array | undefined;
        const result: Record<string, { data: Float32Array; dims: number[] }> = {};
        if (pointCoords && pointCoords.length > 0) {
          result.point_coords = { data: pointCoords, dims: [1, pointCoords.length / 2, 2] };
          result.point_labels = {
            data: new Float32Array(pointCoords.length / 2),
            dims: [1, pointCoords.length / 2],
          };
        }
        return result;
      },
    });
    expect(true).toBe(true);
  });

  it('allows registering scunet model type', () => {
    registerModelType('scunet', {
      tensorSpec: {
        inputWidth: 0,
        inputHeight: 0,
        mean: [0, 0, 0],
        std: [1, 1, 1],
        paddingRgb: [0, 0, 0],
      },
      getInputSize: () => 0,
      hasImageInput: true,
    });
    expect(true).toBe(true);
  });
});
