import { describe, expect, it } from 'vitest';
import {
  type MeasurementCase,
  type MeasurementRecord,
  toVerifiedQualityEvidence,
  validateMeasurementRecord,
} from './measurementRecord';

const ARTIFACTS = { 'model.onnx': 'aaa111' };

function baseCases(): MeasurementCase[] {
  return [
    { caseId: 'c1', category: 'easy', outcome: 'ok', metrics: { iou: 0.9, boundaryF: 0.8 } },
    { caseId: 'c2', category: 'easy', outcome: 'ok', metrics: { iou: 0.8, boundaryF: 0.7 } },
    { caseId: 'c3', category: 'hard', outcome: 'ok', metrics: { iou: 0.5, boundaryF: 0.4 } },
    { caseId: 'c4', category: 'hard', outcome: 'ok', metrics: { iou: 0.6, boundaryF: 0.5 } },
    { caseId: 'c5', category: 'hard', outcome: 'timeout' },
  ];
}

function baseRecord(overrides: Partial<MeasurementRecord> = {}): MeasurementRecord {
  return {
    schemaVersion: 1,
    kind: 'segmentation-quality',
    corpus: { id: 'corpus', version: 'v1', hash: 'corpus-hash', split: 'held-out' },
    identity: {
      codeRevision: 'abc123',
      dirty: false,
      artifactChecksums: ARTIFACTS,
      runtime: {
        executionProvider: 'cpu',
        runtimeName: 'onnxruntime-node',
        runtimeVersion: '1.27.0',
        threads: 1,
      },
      host: { os: 'linux', arch: 'x86_64' },
    },
    verification: 'real-model-harness',
    claims: [{ topic: 'quality', scope: 'cpu' }],
    metrics: [
      {
        name: 'iou',
        direction: 'higher-is-better',
        range: [0, 1],
        aggregation: 'macro',
        role: 'automatic',
      },
      {
        name: 'boundaryF',
        direction: 'higher-is-better',
        range: [0, 1],
        aggregation: 'macro',
        role: 'automatic',
      },
    ],
    requiredCategories: ['easy', 'hard'],
    criticalCategories: ['hard'],
    cases: baseCases(),
    declared: {
      summary: { iou: 0.7, boundaryF: 0.6 },
      perCategory: {
        easy: { iou: 0.85, boundaryF: 0.75 },
        hard: { iou: 0.55, boundaryF: 0.45 },
      },
      worstCritical: {
        iou: { value: 0.55, category: 'hard' },
        boundaryF: { value: 0.45, category: 'hard' },
      },
      caseCounts: { total: 5, ok: 4 },
      reliability: { successRate: 0.8 },
    },
    ...overrides,
  };
}

describe('validateMeasurementRecord', () => {
  it('derives summaries and verifies a consistent record', () => {
    const summary = validateMeasurementRecord(baseRecord());
    expect(summary.status).toBe('verified');
    expect(summary.diagnostics).toEqual([]);
    expect(summary.summary.iou).toBeCloseTo(0.7, 10);
    expect(summary.perCategory.hard?.iou).toBeCloseTo(0.55, 10);
    expect(summary.worstCritical.iou?.canonicalCategory).toBe('hard');
    expect(summary.caseCounts).toMatchObject({ total: 5, ok: 4, timeout: 1 });
    expect(summary.reliability.successRate).toBeCloseTo(0.8, 10);
  });

  it('rejects a declared headline value that disagrees with the cases', () => {
    const record = baseRecord();
    const declared = {
      ...record.declared,
      summary: { ...record.declared.summary, iou: 0.72 },
    };
    const summary = validateMeasurementRecord({ ...record, declared });
    expect(summary.status).toBe('mismatch');
    const diagnostic = summary.diagnostics.find((d) => d.field === 'declared.summary.iou');
    expect(diagnostic?.declared).toBe(0.72);
    expect(diagnostic?.recomputed).toBeCloseTo(0.7, 10);
    expect(diagnostic?.remediation).toContain('recomputed');
  });

  it('catches rounded declarations unless a matching tolerance is declared', () => {
    const record = baseRecord();
    const cases = baseCases().map((measurementCase) =>
      measurementCase.caseId === 'c3'
        ? { ...measurementCase, metrics: { iou: 0.5512345678, boundaryF: 0.4 } }
        : measurementCase,
    );
    const declared = {
      summary: { iou: 0.713, boundaryF: 0.6 },
      perCategory: {
        easy: { iou: 0.85, boundaryF: 0.75 },
        hard: { iou: 0.5756, boundaryF: 0.45 },
      },
      worstCritical: {
        iou: { value: 0.5756, category: 'hard' },
        boundaryF: { value: 0.45, category: 'hard' },
      },
      caseCounts: { total: 5, ok: 4 },
      reliability: { successRate: 0.8 },
    };
    const strict = validateMeasurementRecord({ ...record, cases, declared });
    expect(strict.status).toBe('mismatch');
    expect(strict.diagnostics.some((d) => d.field === 'declared.summary.iou')).toBe(true);

    const tolerated: MeasurementRecord = {
      ...record,
      cases,
      metrics: record.metrics.map((metric) =>
        metric.name === 'iou' ? { ...metric, tolerance: 0.001 } : metric,
      ),
      declared,
    };
    expect(validateMeasurementRecord(tolerated).status).toBe('verified');
  });

  it('handles worst-category ties deterministically and rejects non-members', () => {
    const record = baseRecord();
    const cases: MeasurementCase[] = [
      ...baseCases().map((measurementCase) =>
        measurementCase.caseId === 'c3'
          ? { ...measurementCase, metrics: { iou: 0.5, boundaryF: 0.4 } }
          : measurementCase,
      ),
      { caseId: 'c6', category: 'edge', outcome: 'ok', metrics: { iou: 0.55, boundaryF: 0.6 } },
    ];
    const tied: MeasurementRecord = {
      ...record,
      cases,
      requiredCategories: ['easy', 'hard', 'edge'],
      criticalCategories: ['hard', 'edge'],
      declared: {
        summary: {
          iou: (0.85 + 0.55 + 0.55) / 3,
          boundaryF: (0.75 + 0.6 + 0.45) / 3,
        },
        perCategory: {
          easy: { iou: 0.85, boundaryF: 0.75 },
          hard: { iou: 0.55, boundaryF: 0.45 },
          edge: { iou: 0.55, boundaryF: 0.6 },
        },
        worstCritical: {
          iou: { value: 0.55, category: 'edge' },
          boundaryF: { value: 0.45, category: 'hard' },
        },
        caseCounts: { total: 6, ok: 5 },
        reliability: { successRate: 5 / 6 },
      },
    };
    const declaredMember = validateMeasurementRecord(tied);
    expect(declaredMember.status).toBe('verified');
    expect(declaredMember.worstCritical.iou?.tiedCategories).toEqual(['edge', 'hard']);
    expect(declaredMember.worstCritical.iou?.canonicalCategory).toBe('edge');

    const nonMember = validateMeasurementRecord({
      ...tied,
      declared: {
        ...tied.declared,
        worstCritical: {
          iou: { value: 0.55, category: 'easy' },
          boundaryF: { value: 0.45, category: 'hard' },
        },
      },
    });
    expect(nonMember.status).toBe('mismatch');
    expect(nonMember.diagnostics.some((d) => d.code === 'worst-category-tie')).toBe(true);
  });

  it('treats a missing required category as unverified, not perfect', () => {
    const record = baseRecord();
    const cases = baseCases().filter((measurementCase) => measurementCase.category !== 'hard');
    const summary = validateMeasurementRecord({
      ...record,
      cases,
      declared: {
        ...record.declared,
        summary: { iou: 0.85, boundaryF: 0.75 },
        perCategory: { easy: { iou: 0.85, boundaryF: 0.75 } },
        caseCounts: { total: 2, ok: 2 },
        reliability: { successRate: 1 },
      },
    });
    expect(summary.status).toBe('unverified');
    const diagnostic = summary.diagnostics.find((d) => d.code === 'missing-required-category');
    expect(diagnostic?.category).toBe('hard');
    expect(summary.summary.iou).toBeCloseTo(0.85, 10);
    expect(summary.summary.boundaryF).toBeCloseTo(0.75, 10);
    expect(summary.worstCritical.iou).toBeUndefined();
  });

  it('keeps failed cases in reliability denominators', () => {
    const record = baseRecord();
    const summary = validateMeasurementRecord(record);
    expect(summary.reliability.successRate).toBeCloseTo(4 / 5, 10);

    const optimistic = validateMeasurementRecord({
      ...record,
      declared: { ...record.declared, reliability: { successRate: 1 } },
    });
    expect(optimistic.status).toBe('mismatch');
    expect(optimistic.diagnostics.some((d) => d.field === 'declared.reliability.successRate')).toBe(
      true,
    );
  });

  it('rejects duplicate case ids and count mismatches before aggregation', () => {
    const record = baseRecord();
    const duplicated = validateMeasurementRecord({
      ...record,
      cases: [
        ...record.cases,
        { caseId: 'c1', category: 'easy', outcome: 'ok', metrics: { iou: 1, boundaryF: 1 } },
      ],
    });
    expect(duplicated.status).toBe('mismatch');
    expect(duplicated.diagnostics.some((d) => d.code === 'duplicate-case-id')).toBe(true);

    const miscounted = validateMeasurementRecord({
      ...record,
      declared: { ...record.declared, caseCounts: { total: 4, ok: 4 } },
    });
    expect(miscounted.status).toBe('mismatch');
    expect(miscounted.diagnostics.some((d) => d.code === 'declared-count-mismatch')).toBe(true);
  });

  it('rejects non-finite and out-of-range values', () => {
    const record = baseRecord();
    const cases = baseCases().map((measurementCase) =>
      measurementCase.caseId === 'c3'
        ? { ...measurementCase, metrics: { iou: Number.NaN, boundaryF: 4 } }
        : measurementCase,
    );
    const summary = validateMeasurementRecord({ ...record, cases });
    expect(summary.status).toBe('mismatch');
    expect(summary.diagnostics.some((d) => d.code === 'non-finite-value')).toBe(true);
    expect(summary.diagnostics.some((d) => d.code === 'out-of-range')).toBe(true);
  });

  it('detects artifact substitution and corpus mismatch when a reference is supplied', () => {
    const summary = validateMeasurementRecord(baseRecord(), {
      expectedArtifactChecksums: { 'model.onnx': 'bbb222' },
      expectedCorpusHash: 'other-corpus',
    });
    expect(summary.status).toBe('invalid');
    expect(summary.diagnostics.filter((d) => d.code === 'invalid-record')).toHaveLength(2);
  });

  it('refuses a GPU platform claim backed by a CPU measurement', () => {
    const summary = validateMeasurementRecord({
      ...baseRecord(),
      claims: [{ topic: 'platform', scope: 'webgpu' }],
    });
    expect(summary.status).toBe('mismatch');
    const diagnostic = summary.diagnostics.find((d) => d.code === 'platform-binding');
    expect(diagnostic?.declared).toBe('webgpu');
    expect(diagnostic?.recomputed).toBe('cpu');
  });

  it('refuses to let synthetic or mock evidence authorize claims', () => {
    const synthetic = validateMeasurementRecord({
      ...baseRecord(),
      verification: 'synthetic-fixture',
      claims: [{ topic: 'quality', scope: 'cpu' }],
    });
    expect(synthetic.status).toBe('unverified');
    expect(synthetic.diagnostics.some((d) => d.code === 'provenance-class')).toBe(true);

    const mockPlatform = validateMeasurementRecord({
      ...baseRecord(),
      verification: 'mock-harness',
      claims: [{ topic: 'platform', scope: 'cpu' }],
    });
    expect(mockPlatform.status).toBe('unverified');
  });

  it('does not let oracle values masquerade as automatic top-1', () => {
    const record = baseRecord();
    // Cases carry the automatic quality, not the oracle quality.
    const cases: MeasurementCase[] = baseCases().map((measurementCase) => measurementCase);
    const mislabeled: MeasurementRecord = {
      ...record,
      cases,
      metrics: [
        ...record.metrics,
        {
          name: 'oracleIou',
          direction: 'higher-is-better',
          range: [0, 1],
          aggregation: 'macro',
          role: 'oracle',
        },
      ],
      declared: {
        ...record.declared,
        summary: { ...record.declared.summary, oracleIou: 0.95 },
        perCategory: record.declared.perCategory,
        worstCritical: record.declared.worstCritical,
      },
    };
    // The declared oracle value has no per-case oracle observation.
    const summary = validateMeasurementRecord(mislabeled);
    expect(summary.status).toBe('unverified');
    expect(summary.diagnostics.some((d) => d.code === 'missing-metric')).toBe(true);

    // A record that claims an automatic metric it never measured is unverified.
    const phantom = validateMeasurementRecord({
      ...record,
      metrics: [
        ...record.metrics,
        {
          name: 'top1Iou',
          direction: 'higher-is-better',
          range: [0, 1],
          aggregation: 'macro',
          role: 'automatic',
        },
      ],
      declared: {
        ...record.declared,
        summary: { ...record.declared.summary, top1Iou: 0.9 },
      },
    });
    expect(phantom.status).toBe('unverified');
    expect(phantom.diagnostics.some((d) => d.field === 'declared.summary.top1Iou')).toBe(true);
  });

  it('enforces the declared aggregation and split discipline', () => {
    const record = baseRecord();
    const micro: MeasurementRecord = {
      ...record,
      metrics: record.metrics.map((metric) => ({ ...metric, aggregation: 'micro' as const })),
    };
    // Micro means weight the extra hard case: iou = (0.9+0.8+0.5+0.6)/4 = 0.7 same here,
    // so use uneven categories to make macro and micro differ.
    const uneven: MeasurementRecord = {
      ...micro,
      cases: [
        { caseId: 'c1', category: 'easy', outcome: 'ok', metrics: { iou: 1, boundaryF: 1 } },
        { caseId: 'c3', category: 'hard', outcome: 'ok', metrics: { iou: 0.4, boundaryF: 0.2 } },
        { caseId: 'c4', category: 'hard', outcome: 'ok', metrics: { iou: 0.6, boundaryF: 0.4 } },
      ],
      declared: {
        ...record.declared,
        summary: {
          iou: (1 + 0.4 + 0.6) / 3,
          boundaryF: (1 + 0.2 + 0.4) / 3,
        },
        perCategory: {
          easy: { iou: 1, boundaryF: 1 },
          hard: { iou: 0.5, boundaryF: 0.3 },
        },
        worstCritical: {
          iou: { value: 0.5, category: 'hard' },
          boundaryF: { value: 0.3, category: 'hard' },
        },
        caseCounts: { total: 3, ok: 3 },
        reliability: { successRate: 1 },
      },
    };
    expect(validateMeasurementRecord(uneven).status).toBe('verified');

    const mislabeledAggregation = validateMeasurementRecord({
      ...uneven,
      metrics: uneven.metrics.map((metric) => ({ ...metric, aggregation: 'macro' as const })),
    });
    expect(mislabeledAggregation.status).toBe('mismatch');

    const leakedDevCase = validateMeasurementRecord({
      ...record,
      cases: record.cases.map((measurementCase) =>
        measurementCase.caseId === 'c5' ? { ...measurementCase, split: 'dev' } : measurementCase,
      ),
    });
    expect(leakedDevCase.status).toBe('mismatch');
    expect(leakedDevCase.diagnostics.some((d) => d.code === 'split-leakage')).toBe(true);
  });

  it('projects only verified summaries into routing evidence', () => {
    const verified = toVerifiedQualityEvidence(validateMeasurementRecord(baseRecord()));
    expect(verified?.verified).toBe(true);
    const mismatched = toVerifiedQualityEvidence(
      validateMeasurementRecord({
        ...baseRecord(),
        declared: { ...baseRecord().declared, summary: { iou: 0.1, boundaryF: 0.6 } },
      }),
    );
    expect(mismatched?.verified).toBe(false);
    const invalid = validateMeasurementRecord(baseRecord(), {
      expectedArtifactChecksums: { 'model.onnx': 'wrong' },
    });
    expect(invalid.status).toBe('invalid');
    expect(toVerifiedQualityEvidence(invalid)).toBeUndefined();
  });

  it('allows metrics to be absent in explicitly optional categories', () => {
    const record = baseRecord();
    const cases: MeasurementCase[] = baseCases().map((measurementCase) =>
      measurementCase.caseId === 'c4'
        ? { ...measurementCase, metrics: { iou: 0.6 } }
        : measurementCase,
    );
    const summary = validateMeasurementRecord({
      ...record,
      cases,
      metrics: record.metrics.map((metric) =>
        metric.name === 'boundaryF' ? { ...metric, optionalInCategories: ['hard'] } : metric,
      ),
      declared: {
        ...record.declared,
        summary: { iou: 0.7, boundaryF: (0.75 + 0.4) / 2 },
        perCategory: {
          easy: { iou: 0.85, boundaryF: 0.75 },
          hard: { iou: 0.55, boundaryF: 0.4 },
        },
        worstCritical: {
          iou: { value: 0.55, category: 'hard' },
          boundaryF: { value: 0.4, category: 'hard' },
        },
      },
    });
    expect(summary.status).toBe('verified');
    expect(summary.perCategory.hard?.boundaryF).toBeCloseTo(0.4, 10);
  });
});
