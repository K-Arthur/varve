export type {
  ChromaPlanes,
  ColorizationProgress,
  ColorizationProgressPhase,
  ColorizationRequestContract,
  ColorizationRequestKind,
  ColorizationResultContract,
  InferenceBackend,
  MaskReference,
  PaletteReference,
  ProviderPreference,
  ReferenceImage,
  SourceIdentity,
} from './colorizationRequest';
// Request contract and pipeline dispatch
export {
  detectStaleResult,
  generateColorizationRequestId,
} from './colorizationRequest';
export { combineChromaAtSourceResolution, combineLabToImageData } from './colorSpace';
export { resolveDdColorRuntime } from './ddcolorRuntime';
export { harmonize } from './harmonize';
export type { LineArtOptions, LineArtResult, LineArtStats } from './lineArt';
export { lineArtColorize } from './lineArt';
export { colorizationPipeline, paletteColorize, validatePalette } from './pipeline';
export { dispatchColorization, validateColorizationRequest } from './pipelineDispatch';
export type {
  BackendCapabilities,
  ColorizationProvider,
  ResolvedProvider,
} from './providerAbstraction';
// Provider abstraction
export {
  getAllColorizationProviders,
  getColorizationProvider,
  isWasmModelSafe,
  queryBackendCapabilities,
  registerColorizationProvider,
  resolveColorizationProvider,
} from './providerAbstraction';
// Worker provider (auto-registered)
export { workerColorizationProvider } from './providers/workerProvider';
export { selectiveRecolor } from './recolor';
export { resolveRuntime } from './runtimeResolver';
export type {
  Sam2MaskResult,
  SelectiveRecolorParams,
} from './sam2Recolor';

// SAM2 recolor integration
export {
  applySelectiveRecolor,
  expandContractMask,
  featherMask,
  invertMask,
  sam2RecolorResult,
} from './sam2Recolor';
export { analyzeImageData, classifyTask } from './taskClassifier';
export { colorTransferLab } from './transfer';

export type {
  ColorizationModelConfig,
  ColorizationParams,
  ColorizationPipeline,
  ColorizationRequest,
  ColorizationResult,
  ColorizationWorkflow,
  ImageStats,
  QualityMode,
  RuntimeResolution,
  SourceKind,
  TaskClassification,
} from './types';
