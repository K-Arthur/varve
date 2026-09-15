import { encodeMaskRle } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { rankPromptedMaskCandidates } from './promptedMaskValidation';
import { evaluateFrozenCandidateSets, type FrozenCandidateSet } from './promptedRankingEvaluation';

const WIDTH = 40;
const HEIGHT = 40;
const PROMPTS = {
  points: [{ x: 0.5, y: 0.5, label: 1 as const }],
  box: { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 },
};
const EXCLUDE_PROMPTS = {
  points: [
    { x: 0.5, y: 0.5, label: 1 as const },
    { x: 0.1, y: 0.1, label: 0 as const },
  ],
  box: { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 },
};

function maskWith(predicate: (x: number, y: number) => boolean): Uint8Array {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (predicate(x, y)) mask[y * WIDTH + x] = 255;
    }
  }
  return mask;
}

/**
 * Tall column inside the image but extending well outside the box hint. It
 * must not touch an image edge: edge contact without prompt support sets
 * `requiresRefinement`, and the default ranker deliberately prefers a
 * complete candidate over a refinement-needed one.
 */
const columnMask = maskWith((x, y) => x >= 18 && x <= 22 && y >= 5 && y <= 34);
/** Fits inside the box hint. */
const insideBoxMask = maskWith((x, y) => x >= 10 && x <= 30 && y >= 10 && y <= 30);
/** Covers the exclude anchor. */
const excludeCoveringMask = maskWith((x, y) => x >= 2 && x <= 8 && y >= 2 && y <= 8);

const POLICY_DIVERGENCE_SET: FrozenCandidateSet = {
  caseId: 'frozen-1',
  category: 'part-whole',
  width: WIDTH,
  height: HEIGHT,
  prompts: PROMPTS,
  candidates: [
    { score: 0.8, rle: encodeMaskRle(columnMask) },
    { score: 0.79, rle: encodeMaskRle(insideBoxMask) },
  ],
  candidateIoU: [0.6, 0.9],
};

const ANNOTATED_SET: FrozenCandidateSet = {
  caseId: 'real-photo-1',
  category: 'real-photo',
  width: WIDTH,
  height: HEIGHT,
  prompts: EXCLUDE_PROMPTS,
  candidates: [
    { score: 0.86, rle: encodeMaskRle(columnMask) },
    { score: 0.85, rle: encodeMaskRle(insideBoxMask) },
    { score: 0.95, rle: encodeMaskRle(excludeCoveringMask) },
  ],
  acceptableIndices: [1],
  bestIndex: 1,
};

describe('frozen candidate-set ranking evaluation', () => {
  it('separates candidate generation from ranking on measured oracle IoU', () => {
    const [baseline, guarded] = evaluateFrozenCandidateSets(
      [POLICY_DIVERGENCE_SET],
      ['reviewed-score', 'guarded-band-box'],
    );

    expect(baseline?.meanTop1IoU).toBeCloseTo(0.6, 10);
    expect(baseline?.meanBestAvailableIoU).toBeCloseTo(0.9, 10);
    expect(baseline?.meanRegret).toBeCloseTo(0.3, 10);
    expect(baseline?.top1AcceptableRate).toBe(0);
    expect(baseline?.coverageRate).toBe(1);

    expect(guarded?.meanTop1IoU).toBeCloseTo(0.9, 10);
    expect(guarded?.meanRegret).toBeCloseTo(0, 10);
    expect(guarded?.top1AcceptableRate).toBe(1);
    expect(guarded?.acceptableAtK[0]).toBe(1);
  });

  it('agrees with the real ranker about the selected candidate for every policy', () => {
    const tagged = [
      { index: 0, mask: columnMask, width: WIDTH, height: HEIGHT, score: 0.8 },
      { index: 1, mask: insideBoxMask, width: WIDTH, height: HEIGHT, score: 0.79 },
    ];
    const baseline = rankPromptedMaskCandidates(tagged, PROMPTS, WIDTH, HEIGHT);
    expect(tagged[baseline.selectedIndex]?.index).toBe(0);
    const guarded = rankPromptedMaskCandidates(tagged, PROMPTS, WIDTH, HEIGHT, {
      policy: 'guarded-band-box',
    });
    expect(tagged[guarded.selectedIndex]?.index).toBe(1);
    // Rejections are reported, not hidden: an invalid candidate must never
    // appear as selectable and must not be silently counted as coverage.
    const invalid = rankPromptedMaskCandidates(
      [
        ...tagged,
        { index: 2, mask: excludeCoveringMask, width: WIDTH, height: HEIGHT, score: 0.95 },
      ],
      EXCLUDE_PROMPTS,
      WIDTH,
      HEIGHT,
    );
    expect(invalid.rejectedCount).toBeGreaterThanOrEqual(1);
  });

  it('evaluates human-annotated real-photo sets without a pixel oracle', () => {
    const [baseline, guarded] = evaluateFrozenCandidateSets(
      [ANNOTATED_SET],
      ['reviewed-score', 'guarded-band-box'],
    );
    expect(baseline?.meanTop1IoU).toBeNull();
    expect(baseline?.coverageRate).toBe(1);
    expect(baseline?.top1AcceptableRate).toBe(0);
    expect(baseline?.acceptableAtK).toEqual([0, 1, 0]);
    expect(guarded?.top1AcceptableRate).toBe(1);
    expect(guarded?.acceptableAtK[0]).toBe(1);
    expect(guarded?.perCategory['real-photo']?.cases).toBe(1);
    expect(guarded?.rejectedCandidates).toBe(1);
  });

  it('reports per-category tails with sample counts', () => {
    const [evaluation] = evaluateFrozenCandidateSets(
      [POLICY_DIVERGENCE_SET, { ...POLICY_DIVERGENCE_SET, caseId: 'frozen-2' }],
      ['guarded-band-box'],
    );
    expect(evaluation?.perCategory['part-whole']).toMatchObject({
      cases: 2,
      top1AcceptableRate: 1,
    });
    expect(evaluation?.perCategory['part-whole']?.meanTop1IoU).toBeCloseTo(0.9, 10);
  });
});
