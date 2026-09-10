import { describe, expect, it } from 'vitest';
import { BaseTaskAdapter } from '../TaskAdapter';
import type { InferenceRequest, InferenceResult, TaskCategory } from '../types';

class TestAdapter extends BaseTaskAdapter<ImageData, Uint8Array> {
  readonly task: TaskCategory = 'segmentation';
  readonly supportedModels = ['u2netp'];

  validate(input: ImageData): string | null {
    if (input.width <= 0 || input.height <= 0) {
      return 'Invalid image dimensions.';
    }
    return null;
  }

  async preprocess(input: ImageData, modelId: string): Promise<InferenceRequest> {
    return {
      modelId,
      input,
      signal: undefined,
    };
  }

  async postprocess(_result: InferenceResult, originalInput: ImageData): Promise<Uint8Array> {
    return new Uint8Array(originalInput.width * originalInput.height);
  }

  estimateMemory(input: ImageData, _modelId: string): number {
    return input.width * input.height * 4;
  }
}

describe('BaseTaskAdapter', () => {
  it('validates image dimensions', () => {
    const adapter = new TestAdapter();
    expect(adapter.validate(new ImageData(1, 1))).toBeNull();
    expect(adapter.validate(new ImageData(0, 0))).toBe('Invalid image dimensions.');
  });

  it('returns supported models', () => {
    const adapter = new TestAdapter();
    expect(adapter.supportedModels).toEqual(['u2netp']);
  });

  it('returns correct task category', () => {
    const adapter = new TestAdapter();
    expect(adapter.task).toBe('segmentation');
  });

  it('preprocesses input', async () => {
    const adapter = new TestAdapter();
    const input = new ImageData(100, 100);
    const request = await adapter.preprocess(input, 'u2netp');
    expect(request.modelId).toBe('u2netp');
    expect(request.input).toBe(input);
  });

  it('postprocesses output', async () => {
    const adapter = new TestAdapter();
    const input = new ImageData(10, 10);
    const result: InferenceResult = {
      output: new Float32Array(100),
      executionProvider: 'wasm',
      processingTimeMs: 50,
      modelId: 'u2netp',
      precision: 'fp32',
      inputWidth: 10,
      inputHeight: 10,
      outputWidth: 10,
      outputHeight: 10,
      preprocessingMs: 5,
      inferenceMs: 40,
      postprocessingMs: 5,
      fallback: false,
      tiled: false,
      warnings: [],
    };
    const output = await adapter.postprocess(result, input);
    expect(output.length).toBe(100);
  });

  it('estimates memory from image dimensions', () => {
    const adapter = new TestAdapter();
    const input = new ImageData(100, 200);
    const memory = adapter.estimateMemory(input, 'u2netp');
    expect(memory).toBe(100 * 200 * 4);
  });

  it('sanitizes NaN values in output', () => {
    const adapter = new TestAdapter();
    const data = new Float32Array([1.0, NaN, 3.0, Infinity, 5.0]);
    const { sanitized, warnings } = (
      adapter as unknown as {
        sanitizeOutputData: (
          data: Float32Array,
          min: number,
          max: number,
          label: string,
        ) => { sanitized: Float32Array; warnings: string[] };
      }
    ).sanitizeOutputData(data, 0, 1, 'test');
    expect(sanitized[1]).toBe(0);
    expect(sanitized[3]).toBe(1);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('applies sigmoid activation', () => {
    const adapter = new TestAdapter();
    const data = new Float32Array([0, 1, -1, 2]);
    const activated = (
      adapter as unknown as {
        applySigmoid: (data: Float32Array) => Float32Array;
      }
    ).applySigmoid(data);
    expect(activated[0]).toBeCloseTo(0.5);
    expect(activated[1]).toBeGreaterThan(0.5);
    expect(activated[2]).toBeLessThan(0.5);
  });

  it('thresholds masks', () => {
    const adapter = new TestAdapter();
    const data = new Float32Array([0.1, 0.5, 0.9, 0.3]);
    const masked = (
      adapter as unknown as {
        thresholdMask: (data: Float32Array, threshold: number) => Uint8Array;
      }
    ).thresholdMask(data, 0.5);
    expect(masked[0]).toBe(0);
    expect(masked[1]).toBe(255);
    expect(masked[2]).toBe(255);
    expect(masked[3]).toBe(0);
  });
});
