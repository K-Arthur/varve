export { dHash, hammingDistance, pHash } from '../intelligence/perceptualHash';
export type { LabeledQuery, RetrievalMetrics } from './metrics';
export { evaluateRetrieval } from './metrics';
export {
  EMBEDDING_EVALUATION_CANDIDATES,
  SEMANTIC_PREPROCESSING_VERSION,
  SIGLIP_IMAGE_MODEL,
} from './models';
export { searchNearDuplicates, searchSemantic } from './search';
export type {
  EmbeddingDtype,
  EmbeddingModelSpec,
  EmbeddingVector,
  SemanticEmbeddingRecord,
  SimilarityCandidate,
  SimilarityResult,
  SimilaritySearchMode,
  SimilaritySignals,
} from './types';
export { compatibleEmbeddingSpaces, embeddingSpaceKey } from './types';
