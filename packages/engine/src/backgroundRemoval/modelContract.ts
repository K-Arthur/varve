/**
 * ONNX model contract verification.
 *
 * Validates that a loaded ONNX session's input/output tensor names, shapes,
 * and dtypes match the expected contract for a given model. This catches
 * corrupted downloads, wrong model files, and version mismatches early —
 * before inference produces garbage output.
 *
 * Research basis:
 *   - U^2-Net (u2netp): input "input.1" [1,3,320,320] float32, output "1959" [1,1,320,320] float32
 *   - IS-Net: input "input_image" [1,3,1024,1024] float32, output "output_image" [1,1,1024,1024] float32
 *   - BiRefNet Lite: input "input.1" [1,3,1024,1024] float32, output "output.1" [1,1,1024,1024] float32
 *   - BiRefNet Full: input "input.1" [1,3,1024,1024] float32, output "output.1" [1,1,1024,1024] float32
 *
 * Tensor names are from the rembg ONNX exports (danielgatis/rembg).
 */

import type { WorkerModelId } from './types';

export interface TensorContract {
  name: string;
  /** Names used by verified alternate exports of the same graph. */
  alternateNames?: readonly string[];
  dims: readonly (number | null)[];
  dtype: string;
}

export interface ModelContract {
  inputs: readonly TensorContract[];
  outputs: readonly TensorContract[];
}

/**
 * Expected ONNX tensor contracts for supported segmentation models.
 *
 * Dims use -1 for dynamic/unknown dimensions (batch, height, width).
 * The rembg exports use fixed-size inputs (320 for u2netp, 1024 for others).
 */
export const MODEL_CONTRACTS: Record<string, ModelContract> = {
  u2netp: {
    inputs: [{ name: 'input.1', dims: [1, 3, 320, 320], dtype: 'float32' }],
    outputs: [
      {
        name: '1959',
        alternateNames: ['output.1'],
        dims: [1, 1, 320, 320],
        dtype: 'float32',
      },
    ],
  },
  'u2netp-int8': {
    inputs: [{ name: 'input.1', dims: [1, 3, 320, 320], dtype: 'float32' }],
    outputs: [
      {
        name: '1959',
        alternateNames: ['output.1'],
        dims: [1, 1, 320, 320],
        dtype: 'float32',
      },
    ],
  },
  'isnet-general-use': {
    inputs: [
      {
        name: 'input_image',
        alternateNames: ['input.1'],
        dims: [1, 3, 1024, 1024],
        dtype: 'float32',
      },
    ],
    outputs: [
      {
        name: 'output_image',
        alternateNames: ['output.1'],
        dims: [1, 1, 1024, 1024],
        dtype: 'float32',
      },
    ],
  },
  'birefnet-general-lite': {
    inputs: [{ name: 'input.1', dims: [1, 3, 1024, 1024], dtype: 'float32' }],
    outputs: [{ name: 'output.1', dims: [1, 1, 1024, 1024], dtype: 'float32' }],
  },
  'birefnet-general': {
    inputs: [{ name: 'input.1', dims: [1, 3, 1024, 1024], dtype: 'float32' }],
    outputs: [{ name: 'output.1', dims: [1, 1, 1024, 1024], dtype: 'float32' }],
  },
};

export interface ContractViolation {
  kind: 'input' | 'output';
  index: number;
  field: 'name' | 'dims' | 'dtype';
  expected: string;
  actual: string;
}

export interface ContractValidationResult {
  valid: boolean;
  violations: ContractViolation[];
}

/**
 * Validate an ONNX session against the expected model contract.
 *
 * Performs lenient dimension matching: dynamic dims (null or -1) in the
 * contract match any actual value. This handles models with symbolic dims.
 */
export function validateModelContract(
  modelId: WorkerModelId,
  inputNames: readonly string[],
  outputNames: readonly string[],
  opts: {
    inputDims?: Array<readonly number[] | null>;
    outputDims?: Array<readonly number[] | null>;
    inputDtypes?: Array<string | null>;
    outputDtypes?: Array<string | null>;
  } = {},
): ContractValidationResult {
  const contract = MODEL_CONTRACTS[modelId];
  const violations: ContractViolation[] = [];

  if (!contract) {
    return { valid: true, violations: [] };
  }

  for (let i = 0; i < contract.inputs.length; i++) {
    const expected = contract.inputs[i]!;
    const actualName = inputNames[i] ?? '';
    const allowedNames = [expected.name, ...(expected.alternateNames ?? [])];
    if (actualName && !allowedNames.includes(actualName)) {
      violations.push({
        kind: 'input',
        index: i,
        field: 'name',
        expected: allowedNames.join(' or '),
        actual: actualName,
      });
    }
    const inputDims = opts.inputDims?.[i];
    if (inputDims) {
      if (!dimsMatch(expected.dims, inputDims)) {
        violations.push({
          kind: 'input',
          index: i,
          field: 'dims',
          expected: `[${expected.dims.join(', ')}]`,
          actual: `[${inputDims.join(', ')}]`,
        });
      }
    }
    if (opts.inputDtypes?.[i] && opts.inputDtypes[i] !== expected.dtype) {
      violations.push({
        kind: 'input',
        index: i,
        field: 'dtype',
        expected: expected.dtype,
        actual: opts.inputDtypes[i]!,
      });
    }
  }

  for (let i = 0; i < contract.outputs.length; i++) {
    const expected = contract.outputs[i]!;
    const actualName = outputNames[i] ?? '';
    const allowedNames = [expected.name, ...(expected.alternateNames ?? [])];
    if (actualName && !allowedNames.includes(actualName)) {
      violations.push({
        kind: 'output',
        index: i,
        field: 'name',
        expected: allowedNames.join(' or '),
        actual: actualName,
      });
    }
    const outputDims = opts.outputDims?.[i];
    if (outputDims) {
      if (!dimsMatch(expected.dims, outputDims)) {
        violations.push({
          kind: 'output',
          index: i,
          field: 'dims',
          expected: `[${expected.dims.join(', ')}]`,
          actual: `[${outputDims.join(', ')}]`,
        });
      }
    }
    if (opts.outputDtypes?.[i] && opts.outputDtypes[i] !== expected.dtype) {
      violations.push({
        kind: 'output',
        index: i,
        field: 'dtype',
        expected: expected.dtype,
        actual: opts.outputDtypes[i]!,
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

function dimsMatch(expected: readonly (number | null)[], actual: readonly number[]): boolean {
  if (expected.length !== actual.length) return false;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    if (e !== null && e !== -1 && e !== actual[i]) return false;
  }
  return true;
}
