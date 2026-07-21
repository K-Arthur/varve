/**
 * Picks the sole real ONNX output tensor from a worker result, ignoring
 * the metadata keys the worker always attaches (executionProvider,
 * dimensions, letterbox). Used for single-output models whose exact ONNX
 * output tensor name wasn't recorded during verification (LaMa, RIFE) —
 * safer than hardcoding a name that might be wrong, since it works
 * regardless of what the graph actually calls its output.
 */
const METADATA_KEYS = new Set([
  'executionProvider',
  'originalWidth',
  'originalHeight',
  'paddedWidth',
  'paddedHeight',
  'letterbox',
]);

export interface RawWorkerTensor {
  data: Float32Array;
  dims: number[];
}

function isRawTensor(value: unknown): value is RawWorkerTensor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'dims' in value &&
    (value as { data: unknown }).data instanceof Float32Array
  );
}

export function pickSoleOutputTensor(
  outputs: Record<string, unknown>,
): RawWorkerTensor | undefined {
  for (const [key, value] of Object.entries(outputs)) {
    if (METADATA_KEYS.has(key)) continue;
    if (isRawTensor(value)) return value;
  }
  return undefined;
}
