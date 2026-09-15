import { describe, expect, it } from 'vitest';
import type { ObjectSelectionSession } from '../../context/objectSelectionTypes';
import { objectSelectionCandidateReviewKey } from '../../context/objectSelectionTypes';
import type { Sam2NormalizedPrompts } from '../../tools/sam2PromptCoordinates';
import { buildGenerativeEditSelectionEvidence } from './selectionEvidence';

function objectSession(): ObjectSelectionSession {
  return {
    documentId: 'doc-1',
    nodeId: 'image-1',
    candidateSetId: 'candidate-set-1',
    width: 100,
    height: 80,
    candidates: [
      {
        mask: new Uint8Array(100 * 80),
        confidence: 0.94,
        scoreSource: 'predicted-iou',
        promptContainment: 1,
        promptDiagnostics: {
          hardPixels: 1200,
          hardCoverage: 0.15,
          bounds: { x: 20, y: 10, width: 40, height: 30 },
          componentCount: 1,
          anchoredComponentCount: 1,
          anchoredCoverage: 1,
          unanchoredCoverage: 0,
          ambiguous: false,
          warnings: [],
        },
      },
    ],
    selectedCandidate: 0,
    points: [{ x: 50, y: 30, label: 1 }],
    box: null,
    confidence: 0.94,
    confidenceSource: 'predicted-iou',
    status: 'ready',
    modelId: 'sam2-hiera-tiny',
    sourceLocator: 'asset:image-1',
    sourceFingerprint: 'sha256:source',
    mappingFingerprint: 'mapping-1',
    reviewedCandidateAt: 100,
    reviewedCandidateKey: undefined,
  };
}

const normalizedPrompts: Sam2NormalizedPrompts = {
  points: [{ x: 0.5, y: 0.375, label: 1 }],
  unmappedPointCount: 0,
  unmappedBoxCornerCount: 0,
};

describe('generative edit selection evidence', () => {
  it('requires both visible candidate and compositing-context review', () => {
    const session = objectSession();
    const candidateKey = objectSelectionCandidateReviewKey(session, 0)!;
    session.reviewedCandidateKey = candidateKey;
    const incomplete = buildGenerativeEditSelectionEvidence({
      source: 'object-selection',
      maskFingerprint: 'mask-1',
      reviewedAt: 200,
      objectSelection: session,
      objectSelectionReviewKey: candidateKey,
      generationReviewKey: null,
      generationReviewedAt: null,
      normalizedPrompts,
    });
    expect(incomplete).toBeNull();

    const complete = buildGenerativeEditSelectionEvidence({
      source: 'object-selection',
      maskFingerprint: 'mask-1',
      reviewedAt: 200,
      objectSelection: session,
      objectSelectionReviewKey: candidateKey,
      generationReviewKey: candidateKey,
      generationReviewedAt: 150,
      normalizedPrompts,
    });
    expect(complete).toMatchObject({
      source: 'object-selection',
      verification: 'object-selection-reviewed',
      candidateIndex: 0,
      candidateSetId: 'candidate-set-1',
      promptCoordinateSpace: 'source-image-normalized',
      promptPoints: normalizedPrompts.points,
      candidateReviewedAt: 100,
      reviewedAt: 200,
    });
  });

  it('records manual and carried-forward masks without inventing model provenance', () => {
    expect(
      buildGenerativeEditSelectionEvidence({
        source: 'brush',
        maskFingerprint: 'mask-brush',
        reviewedAt: 300,
      }),
    ).toMatchObject({
      source: 'brush',
      verification: 'explicit-user-review',
    });
    expect(
      buildGenerativeEditSelectionEvidence({
        source: 'persisted',
        maskFingerprint: 'mask-persisted',
        reviewedAt: 301,
      }),
    ).toMatchObject({
      source: 'persisted',
      verification: 'carried-forward',
    });
  });

  it('revokes a candidate review when the reviewed mask bytes change', () => {
    const session = objectSession();
    const reviewedKey = objectSelectionCandidateReviewKey(session, 0);
    expect(reviewedKey).toBeTruthy();

    session.candidates[0]!.mask[50 * session.width + 50] = 255;

    expect(objectSelectionCandidateReviewKey(session, 0)).not.toBe(reviewedKey);
  });
});
