// @vitest-environment node
/**
 * Intent-annotated real-photograph ranking evaluation (G2).
 *
 * The synthetic corpus measures oracle IoU against pixel ground truth. It
 * cannot express intent: for one click, "the whole crab" and "the eye" have
 * different correct answers, so a single oracle number silently disagrees
 * with whichever intent it was not built for.
 *
 * This corpus is therefore annotated, not measured: a reviewer inspected the
 * source, every candidate mask, and the prompt placement for each case, and
 * recorded which candidates are acceptable for the declared intent (evidence
 * sheets in `docs/screenshots/2026-09-15-ranking-annotation/`). No IoU is
 * recorded here, and no policy may be promoted from this file alone.
 *
 * The fixture holds the candidate masks as RLE, so this test runs the real
 * ranking policies with no model, no network, and no GPU.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AnnotatedRankingCase,
  type CandidateRankingPolicyId,
  computeCandidateRankingFeatures,
  evaluateAnnotatedRankingPolicy,
} from '../candidateRanking';
import { decodeMaskRle } from './evidenceRecord';

interface FixtureCase {
  caseId: string;
  category: string;
  intent: string;
  width: number;
  height: number;
  downscale: number;
  prompts: { points: Array<{ x: number; y: number; label: 0 | 1 }>; box?: unknown };
  normalizedPrompts: {
    points: Array<{ x: number; y: number; label: 0 | 1 }>;
    box?: { x1: number; y1: number; x2: number; y2: number };
  };
  scores: number[];
  candidateRle: number[][];
  selectedIndex: number;
  acceptableIndices: number[];
  bestIndex: number | null;
  annotationNotes: string;
  fixtureSha256: string;
  ambiguity: string;
}

interface Fixture {
  status: string;
  reviewedAt: string;
  reviewedBy: string;
  reviewMethod: string;
  promptNote: string;
  modelArtifacts: Record<string, string>;
  cases: FixtureCase[];
  baselines?: Record<
    string,
    { top1AcceptableRate: number; coverageRate: number; meanClicksToAccept: number | null }
  >;
}

const FIXTURE_PATH = resolve(__dirname, 'evidence/annotated-ranking-real-photos-v1.json');
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
const POLICIES: CandidateRankingPolicyId[] = [
  'provider',
  'score',
  'guarded-band-box',
  'guarded-band-area',
];

function toCase(entry: FixtureCase): AnnotatedRankingCase {
  const masks = entry.candidateRle.map((rle) => decodeMaskRle(rle, entry.width * entry.height));
  const features = masks.map((mask, index) =>
    computeCandidateRankingFeatures(
      mask,
      entry.width,
      entry.height,
      entry.normalizedPrompts,
      entry.scores[index] ?? 0,
    ),
  );
  return {
    caseId: entry.caseId,
    category: entry.category,
    features,
    acceptableIndices: entry.acceptableIndices,
    ...(entry.bestIndex !== null ? { bestIndex: entry.bestIndex } : {}),
    providerSelectedIndex: entry.selectedIndex,
  };
}

describe('annotated real-photograph ranking corpus', () => {
  it('is a reviewed, fully annotated fixture with no empty acceptable sets', () => {
    expect(fixture.status).toBe('reviewed');
    expect(fixture.reviewedBy.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const entry of fixture.cases) {
      expect(ids.has(entry.caseId), `duplicate caseId ${entry.caseId}`).toBe(false);
      ids.add(entry.caseId);
      expect(entry.annotationNotes.length).toBeGreaterThan(20);
      expect(entry.ambiguity.length).toBeGreaterThan(20);
      // A case with no acceptable candidate would be an unverified case, not a
      // zero-error result; it must be explained, not silently counted.
      expect(
        entry.acceptableIndices.length,
        `${entry.caseId} has no acceptable candidate; record why instead of leaving it empty`,
      ).toBeGreaterThan(0);
      for (const index of entry.acceptableIndices) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(entry.candidateRle.length);
      }
      if (entry.bestIndex !== null) {
        expect(entry.acceptableIndices).toContain(entry.bestIndex);
      }
      expect(entry.scores.every((score) => Number.isFinite(score))).toBe(true);
      expect(entry.candidateRle.length).toBe(entry.scores.length);
      // Candidate identity is bound to the source bytes, not to the case name.
      expect(entry.fixtureSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
  });

  it('counts the same prompt as two intents when the click is genuinely ambiguous', () => {
    const whole = fixture.cases.find((entry) => entry.caseId === 'crab-subject-whole');
    const eye = fixture.cases.find((entry) => entry.caseId === 'crab-subject-eye');
    expect(whole).toBeDefined();
    expect(eye).toBeDefined();
    // Same prompt, same candidates, different acceptable sets: this is the
    // evidence that intent, not pixels, decides acceptability.
    expect(whole?.prompts).toEqual(eye?.prompts);
    expect(whole?.candidateRle).toEqual(eye?.candidateRle);
    expect(whole?.acceptableIndices).not.toEqual(eye?.acceptableIndices);
  });

  it('reports every policy and holds the recorded baseline', () => {
    const cases = fixture.cases.map(toCase);
    const evaluations = POLICIES.map((policy) => evaluateAnnotatedRankingPolicy(cases, policy));
    for (const evaluation of evaluations) {
      console.log(
        `ANNOTATED ${evaluation.policy.padEnd(18)} cases ${evaluation.cases} top1-accept ${(evaluation.top1AcceptableRate * 100).toFixed(0)}% coverage ${(evaluation.coverageRate * 100).toFixed(0)}% clicks ${evaluation.meanClicksToAccept?.toFixed(2) ?? 'n/a'} best-match ${evaluation.top1MatchesBest} atK=[${evaluation.acceptableAtK.join(',')}]`,
      );
    }

    // Coverage and validation are policy-independent: no ordering may remove a
    // candidate a user could have reviewed.
    const provideBaseline = evaluations.find((entry) => entry.policy === 'provider');
    for (const evaluation of evaluations) {
      expect(evaluation.coverageRate).toBe(provideBaseline?.coverageRate);
      expect(evaluation.casesWithoutAcceptable).toEqual([]);
    }

    if (fixture.baselines) {
      for (const evaluation of evaluations) {
        const baseline = fixture.baselines[evaluation.policy];
        if (!baseline) continue;
        expect(
          evaluation.top1AcceptableRate,
          `${evaluation.policy} top-1 acceptance regressed: ${evaluation.top1AcceptableRate} < recorded ${baseline.top1AcceptableRate}`,
        ).toBeGreaterThanOrEqual(baseline.top1AcceptableRate - 1e-9);
      }
    }
  });

  it('records that a whole-object mask can rank below a part mask', () => {
    const cases = fixture.cases.map(toCase);
    const crabWhole = cases.find((entry) => entry.caseId === 'crab-subject-whole');
    expect(crabWhole).toBeDefined();
    const providerRanking = evaluateAnnotatedRankingPolicy(
      [crabWhole as AnnotatedRankingCase],
      'score',
    );
    // The residual failure is evidence, not a flake: the highest-scoring
    // candidate for a click on a crab is a part mask, while the whole animal is
    // available at a lower predicted IoU. If a future ranker fixes this, the
    // review notes must be updated deliberately rather than the assertion
    // loosened.
    expect(providerRanking.top1AcceptableRate).toBe(0);
    const firstAcceptableRank = providerRanking.acceptableAtK.findIndex((count) => count > 0) + 1;
    // One candidate-cycle reaches the acceptable mask, which is the
    // measurable click cost of the ranking miss.
    expect(firstAcceptableRank).toBe(2);
  });
});
