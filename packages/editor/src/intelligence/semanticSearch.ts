import type { Document } from '@varve/scene';
import { findDuplicateStructures } from './componentDetector';

export interface SimilarityResult {
  nodeId: string;
  score: number;
  matchType: 'structural' | 'content' | 'combined';
}

export function findSimilarComponents(
  doc: Document,
  nodeId: string,
  maxResults: number = 5,
): SimilarityResult[] {
  if (!doc.nodes[nodeId]) return [];

  const groups = findDuplicateStructures(doc);
  const results: SimilarityResult[] = [];

  for (const group of groups) {
    if (!group.nodeIds.includes(nodeId)) continue;

    for (const otherId of group.nodeIds) {
      if (otherId === nodeId) continue;

      results.push({
        nodeId: otherId,
        score: group.score,
        matchType: 'structural',
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}
