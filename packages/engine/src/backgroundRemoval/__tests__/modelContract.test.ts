/**
 * Tests for ONNX model contract verification.
 *
 * Validates that corrupted or mismatched model files are detected
 * before inference produces garbage output.
 */

import { describe, expect, it } from 'vitest';
import { type ContractViolation, MODEL_CONTRACTS, validateModelContract } from '../modelContract';

describe('MODEL_CONTRACTS', () => {
  it('defines contracts for all segmentation models', () => {
    const expectedIds = [
      'u2netp',
      'u2netp-int8',
      'isnet-general-use',
      'birefnet-general-lite',
      'birefnet-general',
    ];
    for (const id of expectedIds) {
      expect(MODEL_CONTRACTS[id]).toBeDefined();
    }
  });

  it('u2netp contract expects 320x320 input/output', () => {
    const c = MODEL_CONTRACTS.u2netp!;
    expect(c.inputs[0]!.dims).toEqual([1, 3, 320, 320]);
    expect(c.outputs[0]!.dims).toEqual([1, 1, 320, 320]);
    expect(c.outputs[0]!.name).toBe('1959');
    expect(c.outputs[0]!.alternateNames).toContain('output.1');
  });

  it('IS-Net and BiRefNet contracts expect 1024x1024 input/output', () => {
    for (const id of ['isnet-general-use', 'birefnet-general-lite', 'birefnet-general']) {
      const c = MODEL_CONTRACTS[id]!;
      expect(c.inputs[0]!.dims).toEqual([1, 3, 1024, 1024]);
      expect(c.outputs[0]!.dims).toEqual([1, 1, 1024, 1024]);
    }
  });
});

describe('validateModelContract — valid sessions', () => {
  it('passes when names match for u2netp', () => {
    const result = validateModelContract('u2netp', ['input.1'], ['1959']);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('passes when names match for IS-Net', () => {
    const result = validateModelContract('isnet-general-use', ['input_image'], ['output_image']);
    expect(result.valid).toBe(true);
  });

  it('accepts the older rembg names as verified aliases', () => {
    const result = validateModelContract('isnet-general-use', ['input.1'], ['output.1']);
    expect(result.valid).toBe(true);
  });

  it('passes when names match for BiRefNet Lite', () => {
    const result = validateModelContract('birefnet-general-lite', ['input.1'], ['output.1']);
    expect(result.valid).toBe(true);
  });

  it('passes for unknown model IDs (no contract to check)', () => {
    const result = validateModelContract('unknown-model' as never, ['x'], ['y']);
    expect(result.valid).toBe(true);
  });

  it('passes when actual names are empty (session metadata unavailable)', () => {
    const result = validateModelContract('u2netp', ['', ''], ['output.1']);
    expect(result.valid).toBe(true);
  });
});

describe('validateModelContract — invalid sessions', () => {
  it('detects mismatched input name', () => {
    const result = validateModelContract('u2netp', ['wrong_name'], ['output.1']);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.kind).toBe('input');
    expect(result.violations[0]!.field).toBe('name');
    expect(result.violations[0]!.expected).toBe('input.1');
    expect(result.violations[0]!.actual).toBe('wrong_name');
  });

  it('detects mismatched output name', () => {
    const result = validateModelContract('u2netp', ['input.1'], ['wrong_output']);
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.kind).toBe('output');
    expect(result.violations[0]!.field).toBe('name');
  });

  it('detects multiple violations', () => {
    const result = validateModelContract('u2netp', ['bad_in'], ['bad_out']);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it('detects dimension mismatch when dims provided', () => {
    const result = validateModelContract('u2netp', ['input.1'], ['output.1'], {
      inputDims: [[1, 3, 640, 640]],
    });
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.field).toBe('dims');
  });

  it('detects dtype mismatch when dtypes provided', () => {
    const result = validateModelContract('u2netp', ['input.1'], ['output.1'], {
      inputDtypes: ['int8'],
    });
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.field).toBe('dtype');
  });

  it('passes when actual dims match contract', () => {
    const result = validateModelContract('u2netp', ['input.1'], ['output.1'], {
      inputDims: [[1, 3, 320, 320]],
      outputDims: [[1, 1, 320, 320]],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects wrong dims even for batch dimension', () => {
    const result = validateModelContract('u2netp', ['input.1'], ['output.1'], {
      inputDims: [[2, 3, 320, 320]],
    });
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.field).toBe('dims');
  });
});

describe('ContractViolation', () => {
  it('formats violation info correctly', () => {
    const v: ContractViolation = {
      kind: 'input',
      index: 0,
      field: 'name',
      expected: 'input.1',
      actual: 'wrong',
    };
    expect(v.kind).toBe('input');
    expect(v.expected).toBe('input.1');
  });
});
