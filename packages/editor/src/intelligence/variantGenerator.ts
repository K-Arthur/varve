import type { Document, NodeId } from '@strata/scene';
import { detectVariantCandidates } from './componentVariantDetector';

export interface VariantGenerationResult {
  candidates: Array<{
    nodeIds: NodeId[];
    variantName: string;
    propertyDiffs: string[];
  }>;
}

/**
 * Detect variant candidates for a component master.
 * Groups child instances by structural similarity,
 * then identifies differing properties within each group.
 */
export function detectVariants(
  doc: Document,
  componentId: string,
): VariantGenerationResult {
  const candidates = detectVariantCandidates(doc);

  return {
    candidates: candidates.map((c) => ({
      nodeIds: c.nodeIds,
      variantName: c.suggestedVariantName,
      propertyDiffs: c.differingProperties.map(
        (dp) => `${dp.property}: ${dp.values.join(', ')}`,
      ),
    })),
  };
}
