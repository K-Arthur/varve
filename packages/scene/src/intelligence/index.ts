export type { AuditIssue } from './audit';
export { runIntelligenceAudit } from './audit';
export type { AuditAdapter } from './auditAdapters';
export {
  adaptAllFindings,
  adaptFindings,
  debtScannerAdapter,
  governanceRulesAdapter,
  linterScannerAdapter,
  sceneIntelligenceAdapter,
} from './auditAdapters';
export type {
  CachedResult,
  CacheLevel,
  CacheStats,
  CacheValidator,
} from './auditCache';
export {
  AuditCache,
  createDocumentRevisionValidator,
  createEvidenceHashValidator,
  createNodeRevisionValidator,
  createTimestampValidator,
  generateEvidenceCacheKey,
  generateNodeCacheKey,
  generatePixelCacheKey,
  generateRuleCacheKey,
} from './auditCache';
export type {
  AuditStage,
  CorrelationResult,
  PipelineContext,
  PipelineOptions,
  PipelineResult,
  PipelineStageId,
  StageResult,
} from './auditPipeline';
export {
  AuditPipeline,
  CodegenAnalysisStage,
  CorrelationStage,
  DocumentStructureStage,
  GeometryStage,
  InteractionStage,
  PixelAnalysisStage,
  RasterStage,
} from './auditPipeline';
export type {
  AuditExecutionPlan,
  AuditExecutionPreferences,
  DocumentChange,
  DocumentChangeType,
  ExecutionSchedule,
  RuleCost,
  SchedulerOptions,
} from './auditScheduler';
export { AuditScheduler, DEFAULT_PREFERENCES } from './auditScheduler';
export type { DebtIssue, DebtReport, DebtScannerOptions, DebtSeverity } from './debtScanner';
export {
  checkDuplicateStyles,
  checkExcessiveNesting,
  checkHardcodedFontSizes,
  checkInconsistentBorderRadius,
  checkInlineSpacing,
  checkLowContrastText,
  checkMissingExportPresets,
  checkMissingFonts,
  checkMixedColorSpaces,
  checkNamingViolations,
  checkOrphanedStyles,
  checkOversetText,
  checkUnnamedLayers,
  checkUntokenizedColors,
  checkUnusedComponents,
  runDebtScan,
} from './debtScanner';
export type {
  FixChange,
  FixPreviewOptions,
  FixPreviewResult,
} from './fixPreview';
export {
  FixPreviewManager,
  getChangeCount,
  getChangeSummary,
  hasChanges,
  isFixPreviewable,
} from './fixPreview';
export type {
  GovernanceIssue,
  GovernanceRulesOptions,
  GovernanceSeverity,
} from './governanceRules';
export {
  findOrphanedStyles,
  findUnusedComponents,
  ruleFonts,
  ruleNaming,
  ruleOrphans,
  ruleSpacingTokens,
  ruleTokenColors,
  runGovernanceRules,
  validateComponentProperties,
  validateNamingConventions,
} from './governanceRules';
export type { FocusOrderAnalysis } from './linterScanner';
export {
  analyzeFocusOrder,
  checkEmptyContainers,
  checkFocusOrder,
  checkNonTextContrast,
  checkOffCanvasLayers,
  checkTouchTargets,
  checkZeroSizeLayers,
  runLinterScan,
} from './linterScanner';
export type {
  LinterCategory,
  LinterConfig,
  LinterFix,
  LinterIssue,
  LinterIssueGroup,
  LinterOptions,
  LinterReport,
  LinterScope,
  LinterSeverity,
} from './linterTypes';
export {
  buildReport,
  createDefaultLinterConfig,
  DEFAULT_LINTER_CONFIG,
} from './linterTypes';
export type {
  CanvasOverlay,
  OverlayManagerOptions,
  OverlayPosition,
  OverlayStyle,
  OverlayType,
} from './overlayManager';
export {
  createBadgeOverlay,
  createHighlightOverlay,
  createOutlineOverlay,
  OverlayManager,
} from './overlayManager';
export type {
  PreflightCheckResult,
  PreflightOptions,
} from './preflightAudit';
export {
  filterForExport,
  getExportSeverity,
  isExportBlocking,
  PreflightAuditManager,
} from './preflightAudit';
export type {
  RevalidationResult,
  SuppressionOptions,
  SuppressionResult,
  SuppressionScope,
} from './suppression';
export {
  canSuppress,
  getRecommendedSuppressionScope,
  SuppressionManager,
} from './suppression';
