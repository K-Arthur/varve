/**
 * @varve/shared — framework-agnostic primitives shared across engine, scene,
 * and UI. Runs in Rust-wasm bindings, web workers, and React components alike.
 */

export type { Affine, DecomposedAffine, Point, Rect } from './affine';
export {
  applyAffine,
  decomposeAffine,
  decomposeAffineFull,
  identity,
  invertAffine,
  multiplyAffine,
  pointInEllipse,
  pointToSegmentDistSq,
  rectContains,
  rotateDeg,
  rotateRad,
  scale,
  scaleXY,
  transform,
  transformRect,
  translate,
  tryInvertAffine,
} from './affine';
export type {
  AlignAxis,
  AlignmentTarget,
  BBox,
  DistributeAxis,
  DistributeMode,
  OBB,
  TidyLayoutResult,
} from './align';
export {
  alignBBox,
  bboxUnion,
  computeAlignmentTarget,
  computeDistribution,
  computeDistributionCenters,
  computeTidyLayout,
  distributeToPosition,
  obbAlignmentTarget,
  obbToAABB,
  orientedBBox,
} from './align';
export type { AnalyticsProvider, HttpAnalyticsProviderOptions } from './analytics/client';
export {
  AnalyticsClient,
  HttpAnalyticsProvider,
  NoopAnalyticsProvider,
  safeAnalyticsEndpoint,
} from './analytics/client';
export {
  ANALYTICS_FORBIDDEN_KEYS,
  eventFields,
  sanitizeAnalyticsContext,
  sanitizeAnalyticsEvent,
} from './analytics/privacy';
export type {
  AnalyticsCategory,
  AnalyticsConsent,
  AnalyticsConsentState,
  AnalyticsContext,
  AnalyticsDurationBucket,
  AnalyticsEvent,
  AnalyticsEventMap,
  AnalyticsEventName,
  AnalyticsExportErrorCode,
  AnalyticsExportFormat,
  AnalyticsFeature,
  AnalyticsOutboundDestination,
  AnalyticsPackageType,
  AnalyticsPlatform,
  AnalyticsReleaseChannel,
  AnalyticsRenderer,
  AnalyticsRendererFallbackReason,
  AnalyticsRuntime,
  AnalyticsWebsitePlatform,
  AnalyticsWebsiteRoute,
} from './analytics/schema';
export {
  ANALYTICS_EVENT_CATEGORIES,
  ANALYTICS_SCHEMA_VERSION,
  DEFAULT_ANALYTICS_CONSENT,
} from './analytics/schema';
export type {
  AuditCategory,
  AuditFinding,
  AuditFix,
  AuditScope,
  AuditSeverity,
  ConfidenceLevel,
  EditorMode,
  ExecutionCost,
  FixCapability,
  FixPreview,
  NodeId,
  SuppressionRecord,
  WorkspaceMode,
} from './auditTypes';
export {
  classifyConfidence,
  evidenceHash,
  generateFindingId,
  isBlockingSeverity,
  mapLegacySeverity,
  sceneFindingToShared,
  serializeEvidence,
  sharedFindingToSceneShape,
  shouldShowByDefault,
} from './auditTypes';
export type { CubicBezier, PathPoint as BezierPathPoint, Point2D } from './bezier';
export {
  cubicBezierBBox,
  cubicBezierClosestPoint,
  cubicBezierDerivative,
  cubicBezierLength,
  cubicBezierPoint,
  cubicBezierSegmentIntersection,
  cubicBezierSplit,
  lineLineIntersection,
  pathPointToBezier,
  pathSegmentIntersections,
  pointToPointDist,
} from './bezier';
export type { ColorBlindnessType } from './colorBlindness';
export { simulateColorBlindness, simulateColorBlindnessCss } from './colorBlindness';
export type {
  BitDepth,
  ManagedColorShim,
  NormalizedRgba,
  RgbWorkingSpaceRef,
} from './colorConversion';
export {
  COLOR_DISPLAY_DECIMALS,
  COLOR_EQUALITY_TOLERANCE,
  COLOR_HUE_DISPLAY_DECIMALS,
  COLOR_SERIALIZATION_PRECISION,
  channelMax,
  clampChannel,
  cmykToRgb,
  convertEncodedRgb,
  DEFAULT_BIT_DEPTH,
  denormalizeChannel,
  gamutMapToSrgb,
  gamutMapToSrgbUnit,
  isAnalyticRgbWorkingSpace,
  labToLch,
  labToRgb,
  labToXyz,
  lchToLab,
  lchToRgb,
  linearRgbPrimariesToXyzD50,
  linearSrgbToOklab,
  linearToProphotoUnit,
  linearToRec2020Unit,
  linearToSrgb,
  linearToSrgbUnit,
  managedColorKey,
  managedColorToCss,
  managedColorToNormalized,
  managedColorToRgba,
  normalizeChannel,
  normalizedToCss,
  normalizeHueDegrees,
  oklabToLinearSrgb,
  oklabToOkLch,
  oklchToOkLab,
  prophotoToLinearUnit,
  rec2020ToLinearUnit,
  rgbPrimariesLabel,
  rgbToCmyk,
  rgbToLab,
  rgbToLch,
  roundTo,
  srgbToLinear,
  srgbToLinearUnit,
  transferDecode,
  transferEncode,
  transferLabel,
  xyzD50ToLinearRgbPrimaries,
  xyzD65ToLinearRgb,
} from './colorConversion';
export type {
  GradientInterpolationSpace,
  GradientStopInput,
  InterpolateOptions,
  InterpolationRgba,
} from './colorInterpolation';
export {
  applyMidpointBias,
  expandGradientStops,
  interpolateManagedColor,
  interpolateNormalizedColor,
  sampleGradientColor,
} from './colorInterpolation';
export type { Oklch, Rgb } from './colorMath';
export {
  binnedMode,
  deltaEOK,
  findAccessibleColor,
  mean,
  median,
  oklchToRgb,
  rgbToOklch,
  stddev,
} from './colorMath';
export {
  autoFixContrast,
  contrastRatio,
  isLargeText,
  relativeLuminance,
  WCAG_AA_LARGE,
  WCAG_AA_NORMAL,
  WCAG_AAA_LARGE,
  WCAG_AAA_NORMAL,
  wcagLevel,
} from './contrast';
export type { RulerMode } from './coordinates';
export {
  artboardToWorld,
  formatCoordForRuler,
  getArtboardRulerOrigin,
  worldToArtboard,
} from './coordinates';
export { cssStringToManagedColor, managedColorToCssString } from './cssColorParser';
export { debounce, throttle } from './debounce';
export type {
  CubicBezierEasingDef,
  EasingDefinition,
  EasingFn,
  EasingKind,
  SpringEasingDef,
  SpringPhysicsParams,
  StepsEasingDef,
} from './easing';
export {
  cubicBezier,
  easeIn,
  easeInOut,
  easeOut,
  getEasingFn,
  linear,
  sampleEasing,
  springPhysics,
  steps,
} from './easing';
export type {
  ColorConversionOptions,
  ColorOperation,
  DitherAlgorithm,
  DitherChannelMode,
  DitherOptions,
  ExportWorkingSpace,
  MetadataFieldDecision,
  MetadataFieldKey,
  MetadataFieldOverrides,
  MetadataPolicy,
  MetadataPolicyKind,
  ProfileSource,
  RasterResizeOptions,
  RenderingIntent,
  ResamplingAlgorithm,
  SharpenMode,
  SharpenOptions,
} from './exportContracts';
export {
  createMetadataPolicy,
  isMetadataFieldDecision,
  isValidMetadataPolicyKind,
  METADATA_OVERRIDE_KEYS,
  METADATA_POLICY_KINDS,
  resolveMetadataFieldDecision,
} from './exportContracts';
export type { PathPoint, SpatialTangents } from './interpolation';
export {
  ensureVertexMatch,
  interpolateAffine,
  interpolateArray,
  interpolateColor,
  interpolateObject,
  interpolatePath,
  interpolateSpatialBezier,
  interpolateValue,
} from './interpolation';
export * from './media';
export type { ResizeModifiers, RotateModifiers } from './modifiers';
export { computeResizeModifiers, computeRotateModifiers } from './modifiers';
export type { OrderKey } from './ordering';
export { generateKeyBetween, generateNKeysBetween, midPoint } from './ordering';
export type {
  AcoColorEntry,
  ActColorEntry,
  ActPalette,
  AseColorEntry,
  AsePalette,
  GplColorEntry,
  GplPalette,
} from './paletteFormats';
export {
  exportAcoPalette,
  exportActPalette,
  exportGplPalette,
  type PaletteFileFormat,
  paletteFileFormat,
  parseAcoPalette,
  parseActPalette,
  parseAsePalette,
  parseGplPalette,
  parsePaletteFile,
} from './paletteFormats';
export type { PathSample } from './pathProjection';
export {
  findNearestKeyframeIndex,
  projectPointOnPath,
  projectPointOnPathWithKeyframes,
  snapToFrame,
  snapToKeyframe,
} from './pathProjection';
export type {
  BenchmarkResult,
  CapabilitySupport,
  DurationSummary,
  MemoryBudget,
  MetricSample,
  PerformanceEnvironment,
  PerformanceProfile,
  PerformanceTrace,
  RenderRevision,
  RuntimeCapabilities,
} from './performance';
export {
  appendBoundedMetric,
  asRenderRevision,
  createPerformanceTrace,
  nextRenderRevision,
  PERFORMANCE_TRACE_SCHEMA_VERSION,
  percentile,
  summarizeDurations,
  validatePerformanceTrace,
} from './performance';
export type {
  PortablePathErrorCode,
  PortablePathValidation,
  PortableProjectPath,
} from './portablePath';
export {
  joinPortableProjectPath,
  portableProjectBasename,
  portableProjectPath,
  validatePortableProjectPath,
} from './portablePath';
export {
  deriveHeight,
  deriveWidth,
  ratioValue,
  roundDimension,
  simplifyRatio,
  swapDimensions,
  validateDimensions,
} from './presetAspectRatio';
export {
  BLANK_DOCUMENT_PRESET,
  BUILTIN_PRESET_GROUPS,
  builtinCategories,
  findBuiltinPreset,
  flattenBuiltinPresets,
} from './presetRegistry';
export type {
  AddCustomPresetResult,
  CustomPreset,
  PresetKVStore,
  PresetLibraryMigration,
  PresetLibraryState,
  PresetMutationResult,
} from './presetStore';
export {
  addCustomPreset,
  CURRENT_PRESET_LIBRARY_SCHEMA_VERSION,
  DEFAULT_PRESET_LIBRARY_STATE,
  dedupeName,
  deleteCustomPreset,
  duplicateCustomPreset,
  loadPresetLibrary,
  PRESET_LIBRARY_MIGRATIONS,
  recordRecent,
  resetBuiltinDerivedState,
  savePresetLibrary,
  toggleFavorite,
  updateCustomPreset,
  validateCustomPreset,
} from './presetStore';
export type {
  ColorMode,
  Preset,
  PresetAspectRatio,
  PresetBleed,
  PresetCategory,
  PresetGroup,
  PresetOrientation,
  PresetSafeArea,
} from './presetTypes';
export type { ProductStatusStage } from './product';
export { PRODUCT_STATUS } from './product';
export type {
  NormalizedProofTransformResult,
  ProfileProofConverter,
  ProfileProofConverterNormalized,
  ProofRenderingIntent,
  ProofTransformConfig,
  ProofTransformResult,
} from './proofTransform';
export {
  applyProofToNormalized,
  applyProofToRgba,
  clearProofConverters,
  isColorOutOfProofGamut,
  isProofingAvailable,
  proofConfigKey,
  registerProfileProofConverter,
  registerProfileProofConverterNormalized,
} from './proofTransform';
export type {
  RasterAlphaMode,
  RasterBitDepth,
  RasterColorEncoding,
  RasterColorModel,
  RasterEncodingProvenance,
  RasterFloatDepth,
  RasterPrecision,
  RgbPrimariesName,
  TransferFunctionName,
  VideoMatrixCoefficients,
  VideoRange,
} from './rasterColorEncoding';
export {
  DISPLAY_SRGB_ENCODING,
  isConvertibleRgbEncoding,
  LEGACY_ASSUMED_ENCODING,
  rasterEncodingKey,
  rasterEncodingLabel,
  rasterProvenanceLabel,
} from './rasterColorEncoding';
export type { BoxCandidate, ResizeHandle, ResizeOptions, SelectionBox } from './selectionBox';
export {
  boxDeltaMatrix,
  computeSelectionBox,
  handlePositions,
  resizeSelectionBox,
  rotateSelectionBox,
  selectionBoxCorners,
  selectionBoxMatrix,
} from './selectionBox';
export type {
  MeasuredLine,
  MeasuredParagraph,
  MeasuredRun,
  MeasureTextFn,
  RichTextMeasureResult,
  RunMeasureOptions,
  TextMeasureOptions,
  TextMeasureResult,
  TextMetricsResult,
} from './textMeasure';
export {
  buildFeatureSettingsCSS,
  buildVariationSettingsCSS,
  measureRichText,
  measureRun,
  measureText,
  measureTextWithCanvas,
  measureWrappedText,
  textWrap,
} from './textMeasure';
export * from './thumbnail/contracts';
export { DEFAULT_ARTWORK_FONT_FAMILY } from './typographyDefaults';
export type { DocumentUnit, SpecUnit } from './units';
export {
  convertDocumentUnit,
  convertPx,
  convertToPx,
  formatPhysical,
  formatValue,
  percentToPx,
  physicalToPx,
  physicalToPxAtDpi,
  ptToPx,
  pxAtDpiToPhysical,
  pxToPercent,
  pxToPhysical,
  pxToPt,
  pxToRem,
  remToPx,
  UNIT_TO_PX,
} from './units';
export {
  DEFAULT_UNTITLED_BASE,
  isValidFileName,
  nextUntitledName,
  sanitizeFileName,
  stripExtension,
} from './untitledName';
export type { Camera, Viewport } from './viewport';
export {
  animateCamera,
  applyCameraTransform,
  buildScreenToWorldAffine,
  buildWorldToScreenAffine,
  centerBoundsCamera,
  clampCamera,
  clampZoom,
  clientToCanvas,
  computeFloatingOrigin,
  DEFAULT_REVEAL_MAX_ZOOM,
  DEFAULT_REVEAL_PADDING,
  FLOATING_ORIGIN_GRID,
  fitBoundsCamera,
  fitZoom,
  isRectInView,
  isWorldRectInViewport,
  lerpCamera,
  localRectToScreen,
  MAX_ZOOM,
  MIN_ZOOM,
  resetViewRotation,
  revealBoundsCamera,
  rotateAboutScreenPoint,
  screenDeltaToWorld,
  screenToWorld,
  simpleScreenToWorld,
  simpleWorldToScreen,
  snapThresholdWorld,
  stepZoom,
  worldToScreen,
  worldToScreenAffine,
  ZOOM_STEP_FACTOR,
  zoomAboutPoint,
} from './viewport';

/** Semantic Strata package marker. */
export const PACKAGE = '@varve/shared' as const;
