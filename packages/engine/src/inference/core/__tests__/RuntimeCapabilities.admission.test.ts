import { describe, expect, it } from 'vitest';
import { evaluateWasmAdmission, type WasmAdmissionAssessment } from '../RuntimeCapabilities';

/**
 * Admission refusals must be explainable.
 *
 * `evaluateWasmAdmission` is the pure decision the worker uses to decide
 * whether a model may create a WASM session. These tests pin the decision
 * boundary and, just as importantly, the sentence a user sees: "not enough
 * memory" is not actionable when the real cause is a page without
 * cross-origin isolation.
 */

const ISOLATED_8GB: Parameters<typeof evaluateWasmAdmission>[0] = {
  modelId: 'grounding-dino-tiny',
  peakBytes: 2_600_000_000,
  peakSource: 'catalog-measurement',
  crossOriginIsolated: true,
  approximateMemoryMB: 8192,
  wasmSafePeakBytes: 3_000_000_000,
};

function assess(
  overrides: Partial<Parameters<typeof evaluateWasmAdmission>[0]> = {},
): WasmAdmissionAssessment {
  return evaluateWasmAdmission({ ...ISOLATED_8GB, ...overrides });
}

describe('evaluateWasmAdmission', () => {
  it('admits a measured peak inside the session budget and names both numbers', () => {
    const result = assess();
    expect(result.allowed).toBe(true);
    expect(result.peakBytes).toBe(2_600_000_000);
    expect(result.peakSource).toBe('catalog-measurement');
    expect(result.detail).toContain('2.6 GB');
    expect(result.detail).toContain('3.0 GB');
  });

  it('admits a peak exactly at the budget', () => {
    expect(assess({ peakBytes: 3_000_000_000 }).allowed).toBe(true);
  });

  it('refuses a peak above the budget and attributes it to the device tier', () => {
    const result = assess({ wasmSafePeakBytes: 1_500_000_000 });
    expect(result.allowed).toBe(false);
    expect(result.detail).toContain('2.6 GB');
    expect(result.detail).toContain('device memory');
  });

  it('attributes a refusal without cross-origin isolation to the missing isolation', () => {
    const result = assess({
      crossOriginIsolated: false,
      approximateMemoryMB: 16_384,
      wasmSafePeakBytes: 1_200_000_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.detail).toMatch(/cross-origin isolation/i);
    expect(result.detail).not.toMatch(/device memory/i);
  });

  it('estimates a peak from file size when the catalog has no measurement', () => {
    const result = assess({
      modelId: 'isnet-general-use',
      peakBytes: undefined,
      modelFileSizeBytes: 178_648_008,
      peakSource: 'file-size-estimate',
      wasmSafePeakBytes: 3_000_000_000,
    });
    expect(result.peakBytes).toBe(178_648_008 * 4);
    expect(result.peakSource).toBe('file-size-estimate');
    expect(result.allowed).toBe(true);
  });

  it('uses the documented u2netp multiplier of three, not four', () => {
    const result = assess({
      modelId: 'u2netp',
      peakBytes: undefined,
      modelFileSizeBytes: 4_574_861,
      peakSource: 'file-size-estimate',
    });
    expect(result.peakBytes).toBe(4_574_861 * 3);
  });

  it('treats an unlisted model as admissible but says there is no record', () => {
    const result = assess({
      modelId: 'unknown-model',
      peakBytes: undefined,
      modelFileSizeBytes: undefined,
      peakSource: 'unlisted-model',
    });
    expect(result.allowed).toBe(true);
    expect(result.detail).toContain('unknown-model');
    expect(result.detail).toMatch(/no admission record/i);
  });

  it('never reports an allowed decision with zero bytes as if it were measured', () => {
    const result = assess({
      modelId: 'unknown-model',
      peakBytes: undefined,
      peakSource: 'unlisted-model',
    });
    expect(result.peakBytes).toBe(0);
    expect(result.peakSource).not.toBe('catalog-measurement');
  });
});
