import type { InferenceRequest, InferenceResult, TaskAdapter, TaskCategory } from './types';

export abstract class BaseTaskAdapter<TInput = unknown, TOutput = unknown>
  implements TaskAdapter<TInput, TOutput>
{
  abstract readonly task: TaskCategory;
  abstract readonly supportedModels: string[];

  abstract validate(input: TInput): string | null;

  abstract preprocess(input: TInput, modelId: string): Promise<InferenceRequest>;

  abstract postprocess(result: InferenceResult, originalInput: TInput): Promise<TOutput>;

  abstract estimateMemory(input: TInput, modelId: string): number;

  protected validateImageDimensions(
    width: number,
    height: number,
    maxPixels: number,
  ): string | null {
    const totalPixels = width * height;
    if (totalPixels <= 0) return 'Image has zero or negative dimensions.';
    if (totalPixels > maxPixels) {
      return `Image too large (${width}x${height} = ${totalPixels} pixels). Maximum: ${maxPixels}.`;
    }
    return null;
  }

  protected validateFloat32Array(
    data: Float32Array,
    expectedLength: number,
    label: string,
  ): string | null {
    if (data.length !== expectedLength) {
      return `${label}: expected ${expectedLength} values, got ${data.length}.`;
    }
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) {
        return `${label}: contains non-finite value at index ${i}.`;
      }
    }
    return null;
  }

  protected validateUint8Array(data: Uint8Array, label: string): string | null {
    if (data.length === 0) return `${label}: empty array.`;
    return null;
  }

  protected sanitizeOutputData(
    data: Float32Array | Uint8Array,
    expectedMin: number,
    expectedMax: number,
    label: string,
  ): { sanitized: Float32Array | Uint8Array; warnings: string[] } {
    const warnings: string[] = [];
    let hasNaN = false;
    let hasInf = false;
    let outOfRange = 0;

    for (let i = 0; i < data.length; i++) {
      const val = data[i]!;
      if (typeof val === 'number') {
        if (!Number.isFinite(val)) {
          if (Number.isNaN(val)) {
            (data as Float32Array)[i] = 0;
            hasNaN = true;
          } else {
            (data as Float32Array)[i] = val > 0 ? expectedMax : expectedMin;
            hasInf = true;
          }
        } else if (val < expectedMin || val > expectedMax) {
          outOfRange++;
        }
      }
    }

    if (hasNaN) warnings.push(`${label}: contained NaN values (replaced with 0).`);
    if (hasInf) warnings.push(`${label}: contained infinite values (clamped).`);
    if (outOfRange > 0) {
      warnings.push(
        `${label}: ${outOfRange} values outside expected range [${expectedMin}, ${expectedMax}].`,
      );
    }

    return { sanitized: data, warnings };
  }

  protected applySigmoid(data: Float32Array): Float32Array {
    const result = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      result[i] = 1 / (1 + Math.exp(-data[i]!));
    }
    return result;
  }

  protected clampToRange(data: Float32Array, min: number, max: number): Float32Array {
    const result = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      result[i] = Math.max(min, Math.min(max, data[i]!));
    }
    return result;
  }

  protected thresholdMask(data: Float32Array | Uint8Array, threshold: number): Uint8Array {
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i]! >= threshold ? 255 : 0;
    }
    return result;
  }
}
