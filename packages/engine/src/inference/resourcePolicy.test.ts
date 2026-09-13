import { describe, expect, it } from 'vitest';
import { assessImageInferenceResources } from './resourcePolicy';

describe('assessImageInferenceResources', () => {
  it('rejects a full-resolution SAM2 source before allocation on a low-memory runtime', () => {
    const assessment = assessImageInferenceResources({
      width: 6000,
      height: 4000,
      modelPeakBytes: 700_000_000,
      runtime: { wasmSafePeakBytes: 400_000_000 },
      operation: 'Object Selection',
    });

    expect(assessment.allowed).toBe(false);
    expect(assessment.reasonCode).toBe('insufficient-memory');
    expect(assessment.reason).toContain('Object Selection');
    expect(assessment.reason).toContain('brush');
  });

  it('accounts for the source working set in addition to model memory', () => {
    const assessment = assessImageInferenceResources({
      width: 4096,
      height: 4096,
      modelPeakBytes: 700_000_000,
      runtime: { wasmSafePeakBytes: 800_000_000 },
    });

    expect(assessment.allowed).toBe(false);
    expect(assessment.estimatedPeakBytes).toBeGreaterThan(700_000_000);
  });

  it('allows a bounded source when the measured safe budget contains it', () => {
    const assessment = assessImageInferenceResources({
      width: 2048,
      height: 1536,
      modelPeakBytes: 700_000_000,
      runtime: { wasmSafePeakBytes: 1_000_000_000 },
    });

    expect(assessment.allowed).toBe(true);
    expect(assessment.reason).toBeUndefined();
  });

  it('rejects invalid dimensions rather than treating them as a safe zero-sized image', () => {
    expect(() =>
      assessImageInferenceResources({
        width: 0,
        height: 1024,
        modelPeakBytes: 700_000_000,
        runtime: { wasmSafePeakBytes: 1_000_000_000 },
      }),
    ).toThrow('Inference reservation dimensions');
  });
});
