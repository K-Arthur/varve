/**
 * Font detection barrel export.
 */

export type { ResolvedFontClass } from './fontClassLabels';
export {
  familyFromLabel,
  getClassIndicesForFamily,
  getKnownFamilies,
  hasFullLabelMap,
  loadFullLabelMap,
  normalizeFamilyName,
  resolveClassIndex,
  TOTAL_CLASS_COUNT,
} from './fontClassLabels';
export type {
  CalibrationInput,
  CalibrationResult,
  ConfidenceConfig,
  MarginAnalysis,
} from './fontConfidence';
export {
  analyzeMargin,
  calibrateConfidence,
  combineScores,
  compositeRenderScore,
  distributionEntropy,
  estimateCropQuality,
  rankCandidates,
  temperatureScale,
} from './fontConfidence';
export type { PipelineDependencies } from './fontDetectionPipeline';
export { detectFont } from './fontDetectionPipeline';
export type {
  ConfidenceCategory,
  CropRegion,
  FontCandidate,
  FontDetectionMode,
  FontDetectionRequest,
  FontDetectionResult,
  FontDetectionStatus,
  MatchType,
  QualityWarning,
  RenderCompareScores,
  TypographyFeatures,
} from './fontDetectionTypes';
export type { RenderCompareRequest, RenderCompareResult } from './fontRenderCompare';
export { renderAndCompare } from './fontRenderCompare';
export {
  estimateTypographyFeatures,
  generateQualityWarnings,
} from './typographyEstimation';
