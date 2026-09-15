import type {
  GenerativeEditSelectionDiagnostics,
  GenerativeEditSelectionEvidence,
  GenerativeEditSelectionSource,
} from '@varve/scene';
import type { ObjectSelectionSession } from '../../context/objectSelectionTypes';
import { objectSelectionCandidateReviewKey } from '../../context/objectSelectionTypes';
import type { Sam2NormalizedPrompts } from '../../tools/sam2PromptCoordinates';

export interface BuildSelectionEvidenceOptions {
  source: GenerativeEditSelectionSource;
  maskFingerprint: string;
  reviewedAt: number;
  objectSelection?: ObjectSelectionSession | null;
  objectSelectionReviewKey?: string | null;
  generationReviewKey?: string | null;
  generationReviewedAt?: number | null;
  normalizedPrompts?: Sam2NormalizedPrompts;
}

function selectionDiagnostics(
  diagnostics: ObjectSelectionSession['candidates'][number]['promptDiagnostics'],
): GenerativeEditSelectionDiagnostics | undefined {
  if (!diagnostics) return undefined;
  return {
    hardPixels: diagnostics.hardPixels,
    hardCoverage: diagnostics.hardCoverage,
    bounds: diagnostics.bounds,
    componentCount: diagnostics.componentCount,
    anchoredComponentCount: diagnostics.anchoredComponentCount,
    anchoredCoverage: diagnostics.anchoredCoverage,
    unanchoredCoverage: diagnostics.unanchoredCoverage,
    ambiguous: diagnostics.ambiguous,
  };
}

/**
 * Build the small, portable record that explains how the final user mask was
 * selected. A prompted candidate is only persisted as Object Selection when
 * both the source panel and the compositing-context review tokens are still
 * current. The raster mask asset remains authoritative for pixels.
 */
export function buildGenerativeEditSelectionEvidence(
  options: BuildSelectionEvidenceOptions,
): GenerativeEditSelectionEvidence | null {
  const {
    source,
    maskFingerprint,
    reviewedAt,
    objectSelection,
    objectSelectionReviewKey,
    generationReviewKey,
    generationReviewedAt,
    normalizedPrompts,
  } = options;
  const base = {
    schemaVersion: 1 as const,
    source,
    maskFingerprint,
    reviewedAt,
  };

  if (source !== 'object-selection') {
    return {
      ...base,
      verification: source === 'persisted' ? 'carried-forward' : 'explicit-user-review',
    };
  }

  const candidate = objectSelection?.candidates[objectSelection.selectedCandidate];
  const candidateKey =
    objectSelection && candidate
      ? objectSelectionCandidateReviewKey(objectSelection, objectSelection.selectedCandidate)
      : null;
  const fullyReviewed =
    objectSelection?.status === 'ready' &&
    candidateKey !== null &&
    candidateKey === objectSelection.reviewedCandidateKey &&
    candidateKey === objectSelectionReviewKey &&
    candidateKey === generationReviewKey &&
    Number.isFinite(objectSelection.reviewedCandidateAt) &&
    Number.isFinite(generationReviewedAt) &&
    typeof objectSelection.sourceFingerprint === 'string' &&
    objectSelection.sourceFingerprint.length > 0 &&
    typeof objectSelection.mappingFingerprint === 'string' &&
    objectSelection.mappingFingerprint.length > 0 &&
    objectSelection.candidateSetId !== undefined;
  if (!fullyReviewed || !objectSelection || !candidate || !candidateKey) return null;

  return {
    ...base,
    verification: 'object-selection-reviewed',
    sourceFingerprint: objectSelection.sourceFingerprint,
    mappingFingerprint: objectSelection.mappingFingerprint,
    candidateReviewKey: candidateKey,
    candidateSetId: objectSelection.candidateSetId,
    candidateIndex: objectSelection.selectedCandidate,
    candidateCount: objectSelection.candidates.length,
    ...(objectSelection.rejectedCandidateCount !== undefined
      ? { rejectedCandidateCount: objectSelection.rejectedCandidateCount }
      : {}),
    candidateScore: candidate.confidence,
    ...(candidate.scoreSource || objectSelection.confidenceSource
      ? { candidateScoreSource: candidate.scoreSource ?? objectSelection.confidenceSource }
      : {}),
    ...(candidate.promptContainment !== undefined
      ? { promptContainment: candidate.promptContainment }
      : {}),
    promptCoordinateSpace: 'source-image-normalized',
    ...(normalizedPrompts?.points ? { promptPoints: normalizedPrompts.points } : {}),
    ...(normalizedPrompts?.box ? { promptBox: normalizedPrompts.box } : {}),
    candidateReviewedAt: objectSelection.reviewedCandidateAt,
    diagnostics: selectionDiagnostics(candidate.promptDiagnostics),
  };
}
