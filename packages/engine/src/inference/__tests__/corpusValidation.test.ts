/**
 * Tests for the background removal validation corpus.
 *
 * Validates that:
 * 1. The corpus manifest follows the v2 schema
 * 2. Every image has a valid maskClassification
 * 3. Ground-truth masks are never mislabeled as reference-model
 * 4. Reference-model masks are never claimed as ground truth
 * 5. Required metadata fields are present
 * 6. Synthetic fixtures are properly separated
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const corpusPath = resolve(
  __dirname,
  '../../../../../tests/fixtures/bg-removal-corpus/corpus.json',
);

interface MaskProvenance {
  modelId?: string;
  modelVersion?: string;
  generatedAt?: string;
  type?: string;
  note?: string;
}

interface CorpusImage {
  id: string;
  file: string;
  category: string;
  description: string;
  dimensions: string;
  source: string;
  license: string;
  allowedRedistribution: boolean;
  maskClassification: 'groundTruth' | 'humanReviewed' | 'referenceModel' | 'synthetic';
  maskProvenance?: MaskProvenance;
  reviewer?: string | null;
  reviewDate?: string | null;
  knownAmbiguities?: string[];
  expectedProperties?: {
    minForegroundRatio: number;
    maxForegroundRatio: number;
    expectedSubjectType: string;
  };
}

interface SyntheticFixture {
  id: string;
  category: string;
  description: string;
  maskClassification: 'synthetic';
  maskProvenance?: MaskProvenance;
}

interface CorpusManifest {
  version: number;
  description: string;
  license: string;
  created: string;
  updated: string;
  corpusDir: string;
  maskClassification: Record<string, string>;
  metrics: {
    supported: string[];
    perCategory: boolean;
    aggregateSeparately: boolean;
    note: string;
  };
  images: CorpusImage[];
  syntheticFixtures?: SyntheticFixture[];
  corpusGuidelines?: {
    groundTruthMaskCreation: string;
    referenceModelUsage: string;
    forbiddenClaims: string[];
  };
}

function loadCorpus(): CorpusManifest {
  const raw = readFileSync(corpusPath, 'utf-8');
  return JSON.parse(raw);
}

describe('Corpus manifest structure', () => {
  const corpus = loadCorpus();

  it('is version 2', () => {
    expect(corpus.version).toBe(2);
  });

  it('has a description', () => {
    expect(corpus.description).toBeTruthy();
  });

  it('has a license', () => {
    expect(corpus.license).toBeTruthy();
  });

  it('has creation and update dates', () => {
    expect(corpus.created).toBeTruthy();
    expect(corpus.updated).toBeTruthy();
  });

  it('has mask classification definitions', () => {
    expect(corpus.maskClassification).toBeDefined();
    expect(corpus.maskClassification.groundTruth).toBeTruthy();
    expect(corpus.maskClassification.humanReviewed).toBeTruthy();
    expect(corpus.maskClassification.referenceModel).toBeTruthy();
    expect(corpus.maskClassification.synthetic).toBeTruthy();
  });

  it('has metrics configuration', () => {
    expect(corpus.metrics).toBeDefined();
    expect(corpus.metrics.supported).toContain('IoU');
    expect(corpus.metrics.supported).toContain('Dice');
    expect(corpus.metrics.supported).toContain('boundaryFScore');
    expect(corpus.metrics.perCategory).toBe(true);
    expect(corpus.metrics.aggregateSeparately).toBe(true);
  });

  it('has corpus guidelines', () => {
    expect(corpus.corpusGuidelines).toBeDefined();
    expect(corpus.corpusGuidelines!.groundTruthMaskCreation).toBeTruthy();
    expect(corpus.corpusGuidelines!.referenceModelUsage).toBeTruthy();
    expect(corpus.corpusGuidelines!.forbiddenClaims.length).toBeGreaterThan(0);
  });
});

describe('Corpus image classification', () => {
  const corpus = loadCorpus();

  for (const image of corpus.images) {
    describe(`image: ${image.id}`, () => {
      it('has a valid maskClassification', () => {
        expect(['groundTruth', 'humanReviewed', 'referenceModel', 'synthetic']).toContain(
          image.maskClassification,
        );
      });

      it('has required metadata fields', () => {
        expect(image.id).toBeTruthy();
        expect(image.file).toBeTruthy();
        expect(image.category).toBeTruthy();
        expect(image.description).toBeTruthy();
        expect(image.dimensions).toBeTruthy();
        expect(image.source).toBeTruthy();
        expect(image.license).toBeTruthy();
        expect(typeof image.allowedRedistribution).toBe('boolean');
      });

      if (image.maskClassification === 'groundTruth') {
        it('ground-truth masks have a reviewer and review date', () => {
          expect(image.reviewer).toBeTruthy();
          expect(image.reviewDate).toBeTruthy();
        });

        it('ground-truth masks have provenance noting independent annotation', () => {
          expect(image.maskProvenance).toBeDefined();
          expect(image.maskProvenance?.note).toContain('annotated');
        });
      }

      if (image.maskClassification === 'humanReviewed') {
        it('human-reviewed masks have a reviewer', () => {
          expect(image.reviewer).toBeTruthy();
        });

        it('human-reviewed masks have provenance noting human correction', () => {
          expect(image.maskProvenance).toBeDefined();
          expect(image.maskProvenance?.note).toContain('corrected');
        });
      }

      if (image.maskClassification === 'referenceModel') {
        it('reference-model masks identify the generating model', () => {
          expect(image.maskProvenance).toBeDefined();
          expect(image.maskProvenance?.modelId).toBeTruthy();
          expect(image.maskProvenance?.modelVersion).toBeTruthy();
        });

        it('reference-model masks do not POSITIVELY claim to be ground truth', () => {
          const note = (image.maskProvenance?.note ?? '').toLowerCase();
          // Allow "not ground truth" or "not ground-truth" (negation), but reject
          // positive claims like "is ground truth" or "ground truth mask"
          const positiveClaimPatterns = [
            /is ground.?truth/,
            /ground.?truth mask/,
            /ground.?truth annotation/,
            /ground.?truth label/,
            /serves as ground.?truth/,
          ];
          for (const pattern of positiveClaimPatterns) {
            expect(note).not.toMatch(pattern);
          }
        });
      }

      it('has known ambiguities documented', () => {
        expect(image.knownAmbiguities).toBeDefined();
        expect(image.knownAmbiguities!.length).toBeGreaterThan(0);
      });

      it('has expected properties with valid foreground ratio range', () => {
        expect(image.expectedProperties).toBeDefined();
        expect(image.expectedProperties!.minForegroundRatio).toBeGreaterThanOrEqual(0);
        expect(image.expectedProperties!.maxForegroundRatio).toBeLessThanOrEqual(1);
        expect(image.expectedProperties!.minForegroundRatio).toBeLessThan(
          image.expectedProperties!.maxForegroundRatio,
        );
      });
    });
  }
});

describe('Synthetic fixtures', () => {
  const corpus = loadCorpus();

  if (corpus.syntheticFixtures) {
    for (const fixture of corpus.syntheticFixtures) {
      it(`synthetic fixture ${fixture.id} is classified as synthetic`, () => {
        expect(fixture.maskClassification).toBe('synthetic');
      });

      it(`synthetic fixture ${fixture.id} has a description`, () => {
        expect(fixture.description).toBeTruthy();
      });
    }
  }
});

describe('Forbidden claims enforcement', () => {
  const corpus = loadCorpus();

  it('no image is labeled groundTruth without a reviewer', () => {
    for (const image of corpus.images) {
      if (image.maskClassification === 'groundTruth') {
        expect(image.reviewer).toBeTruthy();
      }
    }
  });

  it('no referenceModel mask positively claims to be ground truth', () => {
    for (const image of corpus.images) {
      if (image.maskClassification === 'referenceModel') {
        const note = (image.maskProvenance?.note ?? '').toLowerCase();
        const positiveClaimPatterns = [
          /is ground.?truth/,
          /ground.?truth mask/,
          /ground.?truth annotation/,
        ];
        for (const pattern of positiveClaimPatterns) {
          expect(note).not.toMatch(pattern);
        }
      }
    }
  });

  it('corpus guidelines explicitly forbid mislabeling', () => {
    expect(corpus.corpusGuidelines!.forbiddenClaims).toContain(
      'Labeling u2netp outputs as ground truth',
    );
  });
});
