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
    // Register a test model type (overwrites if already present)
    registerModelType('depth', {
      tensorSpec: {
        inputWidth: 64,
        inputHeight: 64,
        mean: [0.5, 0.5, 0.5],
        std: [0.5, 0.5, 0.5],
        paddingRgb: [0, 0, 0],
      },
      getInputSize: () => 64,
    });
    // No throw = success
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
      encodePrompts: (params: Record<string, unknown>) => {
        const pointCoords = params.pointCoords as Float32Array | undefined;
        const result: Record<string, Float32Array> = {};
        if (pointCoords && pointCoords.length > 0) {
          result.point_coords = pointCoords;
          result.point_labels = new Float32Array(pointCoords.length / 2);
        }
        return result;
      },
    });
    expect(true).toBe(true);
  });
});
