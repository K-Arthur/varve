/**
 * Canonical placement identity for automatic foreground proposals.
 *
 * A proposal is only useful when its source pixels still map to the same
 * document location that the user reviewed. Keep this calculation beside the
 * prompted Object Selection path so crop, image offsets, content rotation,
 * flips, and ancestor transforms cannot drift between selection tools.
 */
import type { ForegroundProposalSet } from '@varve/engine/foregroundSelect';
import type { Document, SceneNode } from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { prepareImageMaskMapper } from '../../tools/imageMaskCoordinates';

type SubjectProposalReviewTarget = {
  sourceFingerprint?: string;
  mappingFingerprint?: string;
};

export function subjectProposalMappingFingerprint(
  document: Document,
  node: SceneNode | undefined,
  sourceWidth: number | undefined,
  sourceHeight: number | undefined,
): string | null {
  if (
    !node ||
    !isImageShape(node) ||
    typeof sourceWidth !== 'number' ||
    typeof sourceHeight !== 'number' ||
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }
  return (
    prepareImageMaskMapper({
      document,
      node,
      sourceWidth,
      sourceHeight,
    })?.fingerprint ?? null
  );
}

/**
 * Bind foreground-proposal review to the exact candidate pixels.
 *
 * Candidate indexes are not identities: a provider can reorder candidates,
 * replace a proposal set, or mutate a typed-array buffer while the Inspector
 * remains mounted. The user is approving the highlighted pixels, so the
 * approval must be invalidated when either the binary review mask or the soft
 * alpha used for a raster mask changes.
 */
export function subjectProposalCandidateReviewKey(
  target: SubjectProposalReviewTarget,
  proposals: ForegroundProposalSet,
  candidateIndex: number,
  providerIdentity: string | null = null,
): string | null {
  const candidate = proposals.candidates[candidateIndex];
  const analysisPixels = proposals.analysisWidth * proposals.analysisHeight;
  if (
    !target.sourceFingerprint ||
    !target.mappingFingerprint ||
    !Number.isSafeInteger(candidateIndex) ||
    candidateIndex < 0 ||
    !candidate ||
    !Number.isSafeInteger(proposals.width) ||
    !Number.isSafeInteger(proposals.height) ||
    !Number.isSafeInteger(proposals.analysisWidth) ||
    !Number.isSafeInteger(proposals.analysisHeight) ||
    proposals.width <= 0 ||
    proposals.height <= 0 ||
    proposals.analysisWidth <= 0 ||
    proposals.analysisHeight <= 0 ||
    !Number.isSafeInteger(analysisPixels) ||
    analysisPixels <= 0 ||
    !(candidate.mask instanceof Uint8Array) ||
    candidate.mask.length !== analysisPixels ||
    (candidate.alpha !== undefined &&
      (!(candidate.alpha instanceof Uint8Array) || candidate.alpha.length !== analysisPixels))
  ) {
    return null;
  }

  const fingerprint = (bytes: Uint8Array, tag: number): string => {
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    const mix = (value: number) => {
      h1 = Math.imul(h1 ^ value, 0x01000193);
      h2 = Math.imul(h2 ^ value, 0x85ebca6b);
    };
    const mixUint32 = (value: number) => {
      mix(value & 0xff);
      mix((value >>> 8) & 0xff);
      mix((value >>> 16) & 0xff);
      mix((value >>> 24) & 0xff);
    };
    mix(tag);
    mixUint32(bytes.length);
    for (const byte of bytes) mix(byte);
    return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
  };

  const alphaFingerprint = candidate.alpha ? fingerprint(candidate.alpha, 2) : 'none';
  return [
    target.sourceFingerprint,
    target.mappingFingerprint,
    providerIdentity ?? 'unknown',
    proposals.width,
    proposals.height,
    proposals.analysisWidth,
    proposals.analysisHeight,
    candidateIndex,
    fingerprint(candidate.mask, 1),
    alphaFingerprint,
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join('|');
}
