import { describe, expect, it } from 'vitest';
import { validateMeasurementRecord } from '../validation/measurementRecord';
import type { PromptedQualityValidation } from './promptedRouting';
import { verifyPromptedQualityEvidence } from './promptedRouting';
import {
  EFFICIENT_SAM_QUALITY_VALIDATION,
  MEASURED_CATEGORY_ROWS,
  MOBILE_SAM_QUALITY_VALIDATION,
  measuredCapabilities,
  measuredQualityValidation,
  PROMPTED_MEASURED_ARTIFACT_CHECKSUMS,
  SAM2_QUALITY_VALIDATION,
} from './providerValidation';
import artifactIdentity from './quality/evidence/provider-ab-artifact-identity-2026-09-15.json';
import archivedAb from './quality/evidence/provider-ab-results-2026-09-14.json';
import {
  buildProviderQualityRecord,
  derivePromptedQualityValidation,
  type ProviderAbEvidence,
} from './quality/evidenceRecord';

interface ArchivedRow {
  category: string;
  metrics: { iou: number; boundaryF: number };
  candidateIoUs: number[];
  selectedIndex: number;
  rankingMatchesOracle: boolean;
}

interface ArchivedProvider {
  providerId: string;
  meanIou: number;
  meanBoundaryF: number;
  rows: ArchivedRow[];
}

const archivedProviders = archivedAb.providers as unknown as ArchivedProvider[];

function evidenceFromArchive(provider: ArchivedProvider): ProviderAbEvidence {
  const checksums =
    PROMPTED_MEASURED_ARTIFACT_CHECKSUMS[
      provider.providerId as keyof typeof PROMPTED_MEASURED_ARTIFACT_CHECKSUMS
    ];
  if (!checksums) throw new Error(`unexpected provider ${provider.providerId}`);
  return {
    providerId: provider.providerId,
    label: provider.providerId,
    runtimeEnvironment: 'onnxruntime-node 1.27.0 · CPU · linux x64',
    measuredAt: archivedAb.generatedAt,
    codeRevision: '075bdcfe1',
    artifactChecksums: { ...checksums },
    requiredCategories: provider.rows.map((row) => row.category),
    criticalCategories: ['thin-geometry', 'tiny-object', 'touches-edge', 'hair-fur'],
    rows: provider.rows.map((row) => {
      const bestAvailable = Math.max(...row.candidateIoUs);
      const selected = row.candidateIoUs[row.selectedIndex] ?? 0;
      return {
        category: row.category,
        iou: row.metrics.iou,
        boundaryF: row.metrics.boundaryF,
        bestAvailableIou: bestAvailable,
        regret: bestAvailable - selected,
        rankingMatch: row.rankingMatchesOracle ? 1 : 0,
      };
    }),
  };
}

const PRODUCTION_RECORDS: Record<string, PromptedQualityValidation> = {
  'sam2-hiera-tiny': SAM2_QUALITY_VALIDATION,
  'mobile-sam': MOBILE_SAM_QUALITY_VALIDATION,
  'efficient-sam-ti': EFFICIENT_SAM_QUALITY_VALIDATION,
};

describe('archived A/B evidence pipeline', () => {
  it('recomputes every archived provider summary through the canonical validator', () => {
    for (const provider of archivedProviders) {
      const evidence = evidenceFromArchive(provider);
      const record = buildProviderQualityRecord(evidence);
      const verified = validateMeasurementRecord(record);
      expect(verified.status).toBe('verified');
      expect(verified.summary.iou).toBeCloseTo(provider.meanIou, 10);
      expect(verified.summary.boundaryF).toBeCloseTo(provider.meanBoundaryF, 10);
      expect(verified.caseCounts).toMatchObject({ total: 10, ok: 10 });
    }
  });

  it('keeps production routing records equal to the derived verified summaries', () => {
    for (const provider of archivedProviders) {
      const evidence = evidenceFromArchive(provider);
      const record = buildProviderQualityRecord(evidence);
      const verified = validateMeasurementRecord(record);
      const derived = derivePromptedQualityValidation(evidence, record, verified);
      const production = PRODUCTION_RECORDS[provider.providerId];
      expect(production).toBeDefined();
      expect(production?.evidenceVersion).toBe(2);
      expect(production?.evidenceStatus).toBe('verified');
      expect(production?.categoryIoU).toEqual(derived.categoryIoU);
      expect(production?.categoryBoundaryF).toEqual(derived.categoryBoundaryF);
      expect(production?.meanIoU).toBeCloseTo(derived.meanIoU, 10);
      expect(production?.meanBoundaryF).toBeCloseTo(derived.meanBoundaryF, 10);
      expect(production?.worstCriticalIoU).toBeCloseTo(derived.worstCriticalIoU, 10);
      expect(production?.worstCriticalBoundaryF).toBeCloseTo(derived.worstCriticalBoundaryF, 10);
      expect(production?.worstCriticalIoUCategory).toBe(derived.worstCriticalIoUCategory);
      expect(production?.worstCriticalBoundaryFCategory).toBe(
        derived.worstCriticalBoundaryFCategory,
      );
    }
  });

  it('transcribes the archived rows without drift', () => {
    for (const provider of archivedProviders) {
      const productionRows = MEASURED_CATEGORY_ROWS[provider.providerId];
      expect(productionRows).toHaveLength(provider.rows.length);
      for (const [index, row] of provider.rows.entries()) {
        const productionRow = productionRows?.[index];
        expect(productionRow?.category).toBe(row.category);
        expect(productionRow?.iou).toBe(row.metrics.iou);
        expect(productionRow?.boundaryF).toBe(row.metrics.boundaryF);
      }
    }
  });

  it('binds production records to manifest-pinned artifact bytes', () => {
    for (const [providerId, hashes] of Object.entries(artifactIdentity.artifacts)) {
      const production =
        PROMPTED_MEASURED_ARTIFACT_CHECKSUMS[
          providerId as keyof typeof PROMPTED_MEASURED_ARTIFACT_CHECKSUMS
        ];
      expect(production).toEqual(hashes);
      for (const hash of Object.values(hashes)) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('names the worst category per metric instead of reusing the IoU worst', () => {
    expect(SAM2_QUALITY_VALIDATION.worstCriticalIoUCategory).toBe('touches-edge');
    expect(SAM2_QUALITY_VALIDATION.worstCriticalBoundaryFCategory).toBe('hair-fur');
    expect(MOBILE_SAM_QUALITY_VALIDATION.worstCriticalIoUCategory).toBe('touches-edge');
    expect(EFFICIENT_SAM_QUALITY_VALIDATION.worstCriticalBoundaryFCategory).toBe('hair-fur');
  });

  it('verifies production records before routing and rejects contradictory copies', () => {
    for (const production of Object.values(PRODUCTION_RECORDS)) {
      expect(verifyPromptedQualityEvidence(production)).toEqual({
        status: 'verified',
        reasons: [],
      });
    }
    const corrupted: PromptedQualityValidation = {
      ...SAM2_QUALITY_VALIDATION,
      worstCriticalBoundaryF: 0.99,
    };
    const mismatch = verifyPromptedQualityEvidence(corrupted);
    expect(mismatch.status).toBe('mismatch');
    expect(mismatch.reasons.join(' ')).toContain('boundary F');

    const stale: PromptedQualityValidation = {
      ...SAM2_QUALITY_VALIDATION,
      corpusVersion: 'object-selection-corpus-v0',
    };
    const unverified = verifyPromptedQualityEvidence(stale);
    expect(unverified.status).toBe('unverified');
    expect(unverified.reasons.join(' ')).toContain('corpus');
  });

  it('keeps the production accessors wired to verified records', () => {
    expect(measuredQualityValidation('sam2-hiera-tiny')?.evidenceStatus).toBe('verified');
    expect(measuredQualityValidation('mobile-sam')?.evidenceStatus).toBe('verified');
    expect(measuredQualityValidation('efficient-sam-ti')?.evidenceStatus).toBe('verified');
    expect(measuredCapabilities('efficient-sam-ti')?.maskPrompts).toBe(false);
    expect(measuredQualityValidation('unknown-provider')).toBeUndefined();
  });
});
