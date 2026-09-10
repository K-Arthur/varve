export { dHash, hammingDistance, pHash } from '../intelligence/perceptualHash';
export {
  DINOV2_IMAGE_EMBEDDING_SPEC,
  decodeSemanticImageBytes,
  embedImageForSearch,
  embedImageForSearchWith,
  embedTextForSearch,
  embedTextForSearchWith,
  IMAGE_EMBEDDING_SPECS,
  type ImageEmbeddingRuntimeSpec,
  imageEmbeddingSpecFor,
  SEMANTIC_SOURCE_MAX_DIMENSION,
  type SemanticRgbaImage,
  SIGLIP_IMAGE_EMBEDDING_SPEC,
  SIGLIP_TEXT_EMBEDDING_SPEC,
  type TextEmbeddingRuntimeSpec,
} from './embed';
export type { LabeledQuery, RetrievalMetrics } from './metrics';
export { evaluateRetrieval } from './metrics';
export {
  DINOV2_SMALL_IMAGE_MODEL,
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
