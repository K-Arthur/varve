import { cosineSimilarity } from '../inference/models/siglip';
import { hammingDistance } from '../intelligence/perceptualHash';
import type { EmbeddingVector, SimilaritySignals } from './types';
import {
  compatibleEmbeddingSpaces,
  type SimilarityCandidate,
  type SimilarityResult,
} from './types';

function compareResults<T extends SimilarityCandidate>(
  a: SimilarityResult<T>,
  b: SimilarityResult<T>,
): number {
  return b.score - a.score || a.candidate.id.localeCompare(b.candidate.id);
}

function semanticScore(query: EmbeddingVector, candidate?: EmbeddingVector): number | undefined {
  if (!candidate || !compatibleEmbeddingSpaces(query, candidate)) return undefined;
  return cosineSimilarity(query.values, candidate.values);
}

/**
 * Semantic lane: intentionally scans every compatible vector. Hashes are
 * diagnostic signals only and can never remove semantic candidates.
 */
export function searchSemantic<T extends SimilarityCandidate>(
  query: EmbeddingVector,
  candidates: readonly T[],
  topK = 10,
): SimilarityResult<T>[] {
  return candidates
    .filter((candidate) => Boolean(candidate.embedding))
    .map((candidate) => {
      const score = semanticScore(query, candidate.embedding) ?? -1;
      return {
        candidate,
        score,
        lane: 'semantic' as const,
        signals: { semantic: score, exactContent: false } satisfies SimilaritySignals,
      };
    })
    .filter((result) => result.score >= 0)
    .sort(compareResults)
    .slice(0, topK);
}

/**
 * Duplicate/variant lane. Exact identity and visual fingerprints are the
 * primary evidence. An embedding is optional and only breaks ties/reranks
 * otherwise plausible variants; it is never required for this lane.
 */
export function searchNearDuplicates<T extends SimilarityCandidate>(
  query: SimilarityCandidate & { embedding?: EmbeddingVector },
  candidates: readonly T[],
  topK = 10,
): SimilarityResult<T>[] {
  const queryHashBits = ((query.pHash ?? query.dHash)?.length ?? 0) * 4 || 64;
  return candidates
    .filter((candidate) => candidate.id !== query.id)
    .map((candidate) => {
      const exactContent = Boolean(
        query.exactContentHash && candidate.exactContentHash === query.exactContentHash,
      );
      const dHashDistance =
        query.dHash && candidate.dHash ? hammingDistance(query.dHash, candidate.dHash) : undefined;
      const pHashDistance =
        query.pHash && candidate.pHash ? hammingDistance(query.pHash, candidate.pHash) : undefined;
      const hashScores = [dHashDistance, pHashDistance]
        .filter((distance): distance is number => distance !== undefined)
        .map((distance) => 1 - Math.min(distance / queryHashBits, 1));
      const visualScore = hashScores.length
        ? hashScores.reduce((a, b) => a + b, 0) / hashScores.length
        : 0;
      const semantic =
        query.embedding && candidate.embedding
          ? semanticScore(query.embedding, candidate.embedding)
          : undefined;
      const score = exactContent
        ? 1
        : semantic === undefined
          ? visualScore
          : visualScore * 0.7 + semantic * 0.3;
      return {
        candidate,
        score,
        lane: 'near-duplicates' as const,
        signals: {
          semantic,
          dHashDistance,
          pHashDistance,
          exactContent,
        } satisfies SimilaritySignals,
      };
    })
    .filter((result) => result.signals.exactContent || result.score > 0)
    .sort(compareResults)
    .slice(0, topK);
}
