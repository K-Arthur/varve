import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PromptedCandidateRankingPolicy } from './promptedMaskValidation';
import {
  evaluateFrozenCandidateSets,
  type FrozenCandidateSet,
  type FrozenPolicyEvaluation,
} from './promptedRankingEvaluation';

/**
 * Real-model frozen-set ranking evaluation (G2, gated).
 *
 * Point `VARVE_RANKING_FIXTURE` at one or more comma-separated JSON files
 * produced by the gated A/B harness
 * (`packages/engine/src/segmentation/quality/providerAb.test.ts`). The fixture
 * carries real candidate masks (RLE), provider scores, and oracle IoU per
 * candidate, so this test replays the real ranker without re-running any
 * encoder.
 *
 * The corpus categories are split deterministically into development and
 * held-out halves so a policy comparison is not reported as held-out quality
 * when it was selected on the same cases. With ten single-image categories,
 * even-sorted-index categories are held out.
 */

interface HarnessCase {
  caseId: string;
  category: string;
  width: number;
  height: number;
  prompts: {
    points?: Array<{ x: number; y: number; label: 0 | 1 }>;
    box?: { x1: number; y1: number; x2: number; y2: number };
  };
  scores: number[];
  candidateIoUs: number[];
  providerSelectedIndex: number;
  candidateRle: number[][];
}

interface HarnessProvider {
  providerId: string;
  cases: HarnessCase[];
  artifactChecksums?: Readonly<Record<string, string>>;
}

const FIXTURE_PATHS = (process.env.VARVE_RANKING_FIXTURE ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

function loadProvider(path: string): HarnessProvider {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { providers: HarnessProvider[] };
  const provider = parsed.providers[0];
  if (!provider) throw new Error(`Fixture '${path}' has no providers.`);
  return provider;
}

function toFrozenSets(provider: HarnessProvider): FrozenCandidateSet[] {
  return provider.cases.map((entry) => ({
    caseId: entry.caseId,
    category: entry.category,
    width: entry.width,
    height: entry.height,
    prompts: entry.prompts,
    candidates: entry.scores.map((score, index) => ({
      score,
      rle: entry.candidateRle[index] ?? [],
    })),
    candidateIoU: entry.candidateIoUs,
  }));
}

function splitHeldOut(sets: FrozenCandidateSet[]): {
  dev: FrozenCandidateSet[];
  heldOut: FrozenCandidateSet[];
} {
  const categories = [...new Set(sets.map((set) => set.category))].sort();
  const heldOutCategories = new Set(categories.filter((_, index) => index % 2 === 1));
  return {
    dev: sets.filter((set) => !heldOutCategories.has(set.category)),
    heldOut: sets.filter((set) => heldOutCategories.has(set.category)),
  };
}

const POLICIES: PromptedCandidateRankingPolicy[] = [
  'reviewed-score',
  'score',
  'guarded-band-box',
  'guarded-band-area',
];

function report(label: string, evaluations: FrozenPolicyEvaluation[]): void {
  for (const evaluation of evaluations) {
    console.log(
      `${label} ${evaluation.policy.padEnd(18)} cases ${evaluation.cases} top1 ${evaluation.meanTop1IoU?.toFixed(4) ?? 'n/a'} best ${evaluation.meanBestAvailableIoU?.toFixed(4) ?? 'n/a'} regret ${evaluation.meanRegret?.toFixed(4) ?? 'n/a'} worst ${evaluation.worstRegret?.toFixed(4) ?? 'n/a'} accept ${(evaluation.top1AcceptableRate * 100).toFixed(0)}% coverage ${(evaluation.coverageRate * 100).toFixed(0)}% rejected ${evaluation.rejectedCandidates}`,
    );
  }
}

describe.skipIf(FIXTURE_PATHS.length === 0)(
  'frozen-set ranking evaluation on real model output',
  () => {
    it('evaluates every policy on development and held-out category halves', () => {
      const reportEntries: Array<Record<string, unknown>> = [];
      for (const fixturePath of FIXTURE_PATHS) {
        const provider = loadProvider(fixturePath);
        const sets = toFrozenSets(provider);
        expect(sets.length).toBeGreaterThan(0);
        const { dev, heldOut } = splitHeldOut(sets);
        expect(dev.length).toBeGreaterThan(0);
        expect(heldOut.length).toBeGreaterThan(0);

        const devEvaluations = evaluateFrozenCandidateSets(dev, POLICIES);
        const heldOutEvaluations = evaluateFrozenCandidateSets(heldOut, POLICIES);
        report(`${provider.providerId} dev`, devEvaluations);
        report(`${provider.providerId} held-out`, heldOutEvaluations);
        reportEntries.push({
          providerId: provider.providerId,
          artifacts: provider.artifactChecksums,
          developmentCategories: dev.map((set) => set.category),
          heldOutCategories: heldOut.map((set) => set.category),
          dev: devEvaluations,
          heldOut: heldOutEvaluations,
        });

        const score = heldOutEvaluations.find((evaluation) => evaluation.policy === 'score');
        const guarded = heldOutEvaluations.find(
          (evaluation) => evaluation.policy === 'guarded-band-box',
        );
        expect(score).toBeDefined();
        expect(guarded).toBeDefined();
        // Coverage and validation behaviour must be policy-independent: a
        // reordering policy may never reduce what the user can review.
        expect(guarded?.coverageRate).toBe(score?.coverageRate);
        expect(guarded?.rejectedCandidates).toBe(score?.rejectedCandidates);
        // Regression guard, not a promotion: if the guarded policy is worse on
        // the held-out half, this gate fails and prints the exact numbers.
        expect(
          guarded?.top1AcceptableRate ?? 0,
          `${provider.providerId} held-out acceptance: guarded ${guarded?.top1AcceptableRate} vs score ${score?.top1AcceptableRate}`,
        ).toBeGreaterThanOrEqual(score?.top1AcceptableRate ?? 0);
        expect(guarded?.meanRegret ?? 1).toBeLessThanOrEqual(
          (score?.meanRegret ?? Number.POSITIVE_INFINITY) + 1e-9,
        );
      }
      const reportPath =
        process.env.VARVE_RANKING_REPORT ?? path.resolve('reports/ranking/ranking-evidence.json');
      mkdirSync(path.dirname(reportPath), { recursive: true });
      writeFileSync(
        reportPath,
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            splitRule: 'sorted categories; odd zero-based indexes are held out',
            acceptableRegret: 0.1,
            providers: reportEntries,
          },
          null,
          2,
        )}\n`,
      );
      console.log(`RANKING REPORT: ${reportPath}`);
    });
  },
);
