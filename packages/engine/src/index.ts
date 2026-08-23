/**
 * @varve/engine — dual-backend renderer facade (Strata plan §0.3, ADR-0001).
 *
 * One TypeScript surface drives desktop (native Rust via Tauri IPC) and web
 * (wasm-pack of the same crates). Feature code never knows which backend it
 * is talking to. The render IR is replayed to canvas by `replayIr`.
 */

export type { BlendEvaluationSpace } from '@varve/shared';
export {
  BLEND_EVALUATION_POLICIES,
  blendEvaluationPolicy,
  effectiveBlendEvaluationSpace,
  normalizeBlendEvaluationSpace,
  resolveBlendEvaluationSpace,
} from '@varve/shared';

export {
  createRecordingTarget,
  type DrawCallEntry,
  formatDrawCallLog,
} from './__goldens__/drawCallRecorder';
export {
  backdropChangedSinceLastResolve,
  resolveAdaptiveTextColor,
  sampleRegionBackdrop,
} from './adaptiveContrast';
export type { AdjustmentChannel, AdjustmentParams } from './adjustment';
export {
  analyticalCmykToRgb,
  analyticalRgbToCmyk,
  convertToCmykIcc,
} from './adjustment/colorConversion';
export type { CurvePoint } from './adjustment/curves';
export type { Histogram, HistogramStats } from './adjustment/histogram';
export { autoLevelsParams, computeHistogram } from './adjustment/histogram';
export type { LevelParams } from './adjustment/levels';
export type { SelectiveColorParams, SelectiveColorTarget } from './adjustment/selectiveColor';
export {
  anyRequiresRasterExport,
  effectPixelExpansion,
  getFilterProperties,
  requiresRasterExport,
  totalEffectExpansion,
} from './adjustmentPipeline';
export type { AlphaContour, ContourOptions, ContourShapeNodeData } from './alphaContour';
export { alphaContoursToShapeNodes, extractAlphaContours } from './alphaContour';
export type {
  AlphaMask,
  AreaSelection,
  AreaSelectionExpression,
  AreaSelectionOperation,
  AreaSelectionSettings,
  AreaSelectionShape,
  AreaSelectionStyle,
  EllipseSelectionShape,
  PolygonSelectionShape,
  RasterizeAreaSelectionOptions,
  RasterMaskSelectionShape,
  RectangleSelectionShape,
  SelectionPoint,
} from './areaSelection';
export {
  areaSelectionBounds,
  areaSelectionCoverageAt,
  combineAreaSelections,
  createAreaSelection,
  DEFAULT_AREA_SELECTION_SETTINGS,
  invertAreaSelection,
  rasterizeAreaSelection,
  refineAreaSelection,
  transformAreaSelection,
} from './areaSelection';
export type {
  AreaSelectionRefineOperation,
  RefineAreaSelectionOptions,
} from './areaSelection';
export type {
  BackgroundRemovalOptions,
  BackgroundRemovalResult,
  EnvironmentCapabilities,
  FinalizeMaskOptions,
  FinalizeMaskResult,
  HairMattingOptions,
  HeuristicMethod,
  InferenceDiagnosticEvent,
  MaskComponent,
  MaskComponentBBox,
  ModelInfo,
  ModelMetadata,
  ModelState,
  RemovalMethod,
  TrimapMattingOptions,
} from './backgroundRemoval';
export {
  AVAILABLE_MODELS,
  cancelAllWorkerJobs,
  DEFAULT_PREVIEW_MAX_DIMENSION,
  decodeMaskDataUrl,
  filterMaskByComponents,
  finalizeMaskResult,
  findConnectedComponents,
  getBestOnnxProviders,
  getEnvironmentCapabilities,
  getEnvironmentCapabilitiesSync,
  getInferenceDiagnostics,
  getModelInfo,
  getModelLoader,
  getModelLoaderReady,
  isWasmModelSafe,
  MODEL_INFO_MAP,
  maskArrayToDataUrl,
  maskFromImageData,
  maskToImageData,
  preferredWorkerModelIdForMethod,
  refineHairMatting,
  removeBackground,
  resetEnvironmentCapabilities,
  resetModelLoader,
  saveModelBlob,
  solveTrimapMatting,
  subscribeInferenceDiagnostics,
  TRIMap,
  terminateWorkerPool,
  trimapFromMask,
  workerModelIdForMethod,
} from './backgroundRemoval';
export * from './backup';
export { cubicBezierPoint } from './bezier';
export { applyBlackAndWhite, type BlackAndWhiteParams } from './blackAndWhite';
export type {
  BlendCategory,
  BlendDomain,
  BlendModeDefinition,
  CanvasBlendOperation,
  PdfBlendModeName,
} from './blendModeCatalog';
export {
  BLEND_MODE_DEFINITIONS,
  blendModeDefinition,
  blendModesForDomain,
} from './blendModeCatalog';
export {
  blend,
  blendColorBurn,
  blendColorDodge,
  blendDarken,
  blendDifference,
  blendExclusion,
  blendHardLight,
  blendLighten,
  blendMultiply,
  blendNormal,
  blendOverlay,
  blendPixels,
  blendPlusDarker,
  blendPlusLighter,
  blendScreen,
  blendSoftLight,
} from './blendModes';
export { gaussianBlurSeparable } from './blur';
export type {
  ColorHalftoneDotShape,
  ColorHalftoneMode,
  ColorHalftoneParams,
} from './colorHalftone';
export {
  applyColorHalftone,
  COLOR_HALFTONE_PRESETS,
} from './colorHalftone';
export { generateColorizationRequestId } from './colorization/colorizationRequest';
export { combineLabToImageData } from './colorization/colorSpace';
export { harmonize } from './colorization/harmonize';
export { colorizationPipeline, paletteColorize } from './colorization/pipeline';
export { dispatchColorization, validateColorizationRequest } from './colorization/pipelineDispatch';
export { selectiveRecolor } from './colorization/recolor';
export { DD_COLOR_MODELS, resolveRuntime } from './colorization/runtimeResolver';
export { analyzeImageData, classifyTask } from './colorization/taskClassifier';
export { colorTransferLab } from './colorization/transfer';
export type {
  ColorizationParams,
  ColorizationProgress,
  ColorizationResult,
  ColorizationWorkflow,
  QualityMode,
  RuntimeResolution,
  TaskClassification,
} from './colorization/types';
export type { ColourEngine, ColourWasmModule } from './colour/colourLoader';
export { createColourEngineFromModule, loadColourWasmModule } from './colour/colourLoader';
export {
  convertSrgbBufferToCmykWasm,
  getColourProfileInfo,
  getColourWasm,
  isColourWasmAvailable,
  prewarmColourWasm,
  srgbToCmykWasm,
  validateColourProfile,
} from './colourWasm';
export type { CompositeCanvasOptions } from './compositeCanvas';
export { blendPixels as canvasBlendPixels, CompositeCanvas, mapBlendMode } from './compositeCanvas';
// ── Content-Aware Fill ─────────────────────────────────────────────
export type {
  ContentAwareFillOptions,
  ContentAwareFillOutputMode,
  ContentAwareFillQuality,
  ContentAwareFillResult,
  FillTransform,
} from './contentAwareFill';
export {
  applyFillTransform,
  compositeFillResult,
  computeFillOffset,
  computeMaskBounds,
  extractBoundedContext,
  mapMaskThroughTransform,
  patchMatchFill,
  QUALITY_DESCRIPTIONS,
  QUALITY_LABELS,
  runContentAwareFillPipeline,
  runLaMaInference,
  unmapFillResult,
} from './contentAwareFill';
export type {
  DenoiseOptions,
  DenoiseProvider,
  DenoiseResult,
  DenoiseTileRequest,
  DenoiseTileResult,
} from './denoiseProviders';
// ── Denoise (SCUNet) ─────────────────────────────────────────────────
export { dispatchDenoise, nativeDenoiseProvider, workerDenoiseProvider } from './denoiseProviders';
export type {
  DepthMap,
  DepthMapMetadata,
  DepthMapResource,
  DepthType,
  DepthUnit,
  NearFarConvention,
} from './depthMap';
export {
  DepthMapCache,
  depthCacheKey,
  depthRangeToMask,
  deserializeDepthMap,
  normalizeDepthPrediction,
  resizeDepthMap,
  sampleDepth,
  serializeDepthMap,
} from './depthMap';
export { applyDuotone, type DuotoneParams } from './duotone';
export type { EffectContractEntry, QualityTier, WorkingSpace } from './effectContract';
export {
  anyLinearLightEffect,
  getEffectContract,
  getEffectContracts,
  requiresColorManagedPipeline,
} from './effectContract';
export { compositeMaskedEffectPixels, type PixelImageData } from './effectMaskCompositor';
export {
  applyBackgroundBlurBackdrop,
  applyChromaticAberration,
  applyGlassMaterialBackdrop,
  applyGlitch,
  applyLayerBlur,
  clampByte,
  computeScreenBounds,
} from './effectPipeline';
export type { Engine } from './engine';
export {
  applyStyleOverrides,
  createEngine,
  createWasmEngineFromModule,
  tryWasmEngine,
} from './engine';
export type { TileExportOpts } from './export';
export { getCanvasSizeLimit, tiledExport } from './export';
export type { DitherImageOptions, DitherResult } from './exportPipeline/dither';
export { bayerThresholdMatrix, ditherImageData } from './exportPipeline/dither';
export type { PaletteQuantizeOptions, PaletteQuantizeResult } from './exportPipeline/palette';
export { quantizeToPalette } from './exportPipeline/palette';
export type { RasterPipelineOptions, RasterPipelineResult } from './exportPipeline/pipeline';
export { runRasterPipeline } from './exportPipeline/pipeline';
export type {
  ResampleOptions,
  ResampleResult,
  SelectAlgorithmResult,
} from './exportPipeline/resample';
export {
  computeResampleDimensions,
  kernelFor,
  resampleImageData,
  selectResamplingAlgorithm,
} from './exportPipeline/resample';
export type { SharpenImageOptions, SharpenResult } from './exportPipeline/sharpen';
export { sharpenImageData } from './exportPipeline/sharpen';
export { exportRasterizedSubtree, exportRasterizedSubtreeSync } from './exportRasterizedSubtree';
export { applyFilterWithCompositing, applySoftwareFilter } from './filterCompositor';
export type {
  Adjustment,
  AdjustmentBase,
  AdjustmentBlendMode,
  AdjustmentKind,
  BlackAndWhiteAdjustment,
  BloomAdjustment,
  BlurAdjustment,
  BrightnessAdjustment,
  CausticsAdjustment,
  ChannelMixerAdjustment,
  ColorBalanceAdjustment,
  ColorBalanceTriplet,
  ColorHalftoneAdjustment,
  ContrastAdjustment,
  CrtAdjustment,
  CurvesAdjustment,
  CurvesPoint,
  DitherAdjustment,
  DuotoneAdjustment,
  EmbeddedGradientColorStop,
  EmbeddedGradientOpacityStop,
  EmbeddedGradientPreset,
  ExposureAdjustment,
  GradientMapAdjustment,
  GradientMapOpacityStop,
  GradientMapStop,
  GrayscaleAdjustment,
  HalftoneAdjustment,
  HueRotateAdjustment,
  InvertAdjustment,
  LensFlareAdjustment,
  LevelsAdjustment,
  LightLeakAdjustment,
  LightShaftsAdjustment,
  LutAdjustment,
  OpacityAdjustment,
  PaletteSnapAdjustment,
  PhotoFilterAdjustment,
  PosterizeAdjustment,
  RgbSplitAdjustment,
  SaturationAdjustment,
  SelectiveColorAdjustment,
  SepiaAdjustment,
  SharpenAdjustment,
  TemperatureAdjustment,
  ThresholdAdjustment,
  TintAdjustment,
  TritoneAdjustment,
  VhsAdjustment,
  VibranceAdjustment,
} from './filters';
export {
  adjustmentDefaults,
  adjustmentsToFilters,
  adjustmentToFilter,
  applyFilterChain,
  filterChainToCss,
  filterKindDisplayName,
  filterToCss,
  isKnownAdjustmentKind,
  makeAdjustment,
} from './filters';
export * from './font';
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
} from './fontDetection';
export * from './fontDetection';
export type {
  ExportFontRequest,
  FontEntry,
  FontLoadState,
  FontMetadata,
  VariableAxisInfo,
} from './fontRegistry';
export {
  awaitExportsReady,
  FontRegistry,
  getFontRegistry,
  resetFontRegistry,
} from './fontRegistry';
export * from './geometry';
export type {
  GifExportOptions,
  GifExportResult,
  GifFrameRenderer,
} from './gifExport';
export {
  checkGifExportSupport,
  exportTimelineToGif,
} from './gifExport';
export type { AdapterSelectionResult } from './gpuAdapter';
export { isSoftwareAdapter, selectWebGpuAdapter } from './gpuAdapter';
export type {
  GradientLut,
  GradientMapLuminanceMode,
  GradientMapParams,
  GradientMapStop as GradientMapFilterStop,
} from './gradientMap';
export {
  applyGradientMapFilter,
  buildGradientAlphaLut,
  buildGradientColorLut,
  buildGradientLUT,
  DEFAULT_GRADIENT_LUT_SIZE,
  interpolateGradientMapColor,
} from './gradientMap';
export type { GrainAnchor, GrainResolution, GrainSampleParams } from './grainSampler';
export {
  grainTextureCoords,
  isProceduralGrain,
  PROCEDURAL_GRAIN_ID,
  prepareGrain,
  resolveGrainDetailed,
  resolveGrainPlane,
  resolveGrainValue,
  resolveGrainValueSync,
  sampleGrainPlane,
  sampleProceduralGrain,
  shapeGrainValue,
} from './grainSampler';
export type { GrainPlane, GrainSource, GrainWrapMode } from './grainTexture';
export {
  DEFAULT_GRAIN_CACHE_BYTES,
  decodeGrainPlane,
  GrainTextureCache,
  getGrainTextureCache,
  MAX_GRAIN_DIMENSION,
  resetGrainTextureCache,
  samplePlane,
} from './grainTexture';
export type {
  HalftoneChannel,
  HalftoneDotShape,
  HalftoneMethod,
  HalftoneParams,
  HalftonePattern,
  HalftonePreset,
} from './halftone';
export {
  applyBayerDithering,
  applyHalftone,
  BAYER_DEFAULT_SIZE,
  bayerMatrix,
  HALFTONE_PRESETS,
} from './halftone';
export type {
  ConvertedImage,
  ExportImageResource,
  ImageConversionOptions,
} from './iccImageConverter';
export {
  buildExportImageManifest,
  collectImageSrcsFromFills,
  convertImageForExport,
  invalidateIccCache,
  loadImagePixels,
  scaleDimensions,
} from './iccImageConverter';
export * from './icon';
export type {
  CachedImage,
  ImageCacheColorVariant,
  ImageCacheEntry,
  ImageLoadState,
} from './imageCache';
export { cachedImageDims, getImageCache, ImageCache, resetImageCache } from './imageCache';
export type {
  DenoiseStrength,
  UpscaleMethod,
  UpscaleOptions,
  UpscaleProgressFn,
  UpscaleStageChangeFn,
} from './imageEnhancement';
export {
  computeUpscaleDimensions,
  DEFAULT_AI_UPSCALE_MODEL_ID,
  upscaleImageData,
  upscalePreviewRegion,
} from './imageEnhancement';
export type { ImageErrorCode } from './imageErrors';
export {
  IMAGE_ERROR_CODES,
  ImageLoadError,
  isImageErrorCode,
  isPermanentImageFailure,
} from './imageErrors';
export {
  FAILED_PLACEHOLDER_FILL,
  imagePlaceholderFill,
  LOADING_PLACEHOLDER_FILL,
} from './imagePlaceholder';
export type {
  ComputeImagePlacementOptions,
  ImagePlacement,
  ImagePlacementFit,
  ImagePlacementPoint,
  ImagePlacementRect,
} from './imagePlacement';
export {
  computeImagePlacement,
  localToSourcePixel,
  sourcePixelToLocal,
} from './imagePlacement';
export {
  generateSyntheticFixtureImage,
  getSyntheticFixtures,
  QUALITY_MANIFEST,
} from './imageQuality/corpusManifest';
export { evaluateFixture, generateReport } from './imageQuality/evaluator';
export {
  computeAlphaDifference,
  computeColorDifference,
  computeMultiScaleSsim,
  computePsnr,
  computeSsim,
} from './imageQuality/metrics';
export type {
  QualityCategory,
  QualityFixture,
  QualityFixtureManifest,
  QualityMetricResult,
  QualityReport,
} from './imageQuality/qualityTypes';
export {
  imageResourceRegistrySize,
  isImageResourceHandle,
  registerImageResourceHandle,
  resetImageResourceRegistry,
  resolveImageResourceHandle,
  retainImageResourceHandles,
  unregisterImageResourceHandle,
  walkTableCellContents,
} from './imageResourceRegistry';
export type {
  DownloadProgress,
  EmbeddingCacheOptions,
  InferenceEvents,
  InferenceProvider,
  InferenceRequest,
  InferenceResult,
  ManagedSession,
  ModelAcquisition,
  ModelInputSpec,
  ModelInstallInfo,
  ModelInstallSource,
  ModelManifestEntry,
  ModelSource,
  ModelState as InferenceModelState,
  ModelUnavailableReason,
  ProviderChainOptions,
  RuntimeCapabilities,
} from './inference';
export {
  createDiagnosticsLabel,
  DownloadManager,
  deriveAcquisition,
  disposeInferenceWorkerHost,
  EmbeddingCache,
  getInferenceWorkerHost,
  getModelById,
  getRuntimeCapabilities,
  InferenceError,
  InferenceWorkerHost,
  isInferenceError,
  listAllModels,
  ModelRegistry,
  resetRuntimeCapabilities,
  resolveAcquisition,
  runProviderChain,
  SessionManager,
} from './inference';
export type {
  WorkerInferRequest,
  WorkerInferResult,
  WorkerModelType,
} from './inference/inferenceWorker';
export { DD_COLOR_INPUT_SIZE, decodeDdColorOutput } from './inference/models/ddcolor';
export { decodeDepthOutput, depthToMask } from './inference/models/depth';
export { decodeDetrOutput } from './inference/models/detr';
export { decodeEfficientNetOutput } from './inference/models/efficientnet';
export {
  decodeFontClassifyOutput,
  FONT_CLASSIFY_INPUT_SIZE,
  FONT_CLASSIFY_NUM_CLASSES,
  FONT_CLASSIFY_TENSOR_SPEC,
} from './inference/models/fontClassify';
export { decodeLineArtOutput, LINE_ART_INPUT_SIZE } from './inference/models/lineArt';
export type { TextRegion } from './inference/models/paddleocr';
export { decodeTextRegions, padToStride } from './inference/models/paddleocr';
export type { PaddleRecInput, PaddleRecResult } from './inference/models/paddlerec';
export { ctcDecode, packRecTensor } from './inference/models/paddlerec';
export { decodeRifeOutput, RIFE_INPUT_SIZE } from './inference/models/rife';
export type {
  Sam2DecoderInput,
  Sam2DecoderOutput,
  Sam2EncoderInput,
  Sam2EncoderOutput,
  Sam2MaskCandidate,
  Sam2Prompt,
} from './inference/models/sam2';
export {
  decodeSam2DecoderOutput,
  encodeSam2Prompts,
  resizeMaskBilinear,
  SAM2_INPUT_SIZE,
  SAM2_TENSOR_SPEC,
  validateSam2Prompts,
} from './inference/models/sam2';
export type { ScunetInferenceInput, ScunetInferenceOutput } from './inference/models/scunet';
export {
  postprocessScunet,
  preprocessScunet,
  SCUNET_INPUT_SIZE,
  SCUNET_TENSOR_SPEC,
  validateScunetInput,
} from './inference/models/scunet';
export {
  normalizeEmbedding,
  rankBySimilarity,
  SIGLIP_TEXT_EMBEDDING_OUTPUT_NAME,
  SIGLIP_TEXT_MAX_LENGTH,
  SIGLIP_TEXT_MODEL_ID,
} from './inference/models/siglip';
export type { SiglipTokenizedText } from './inference/models/siglipText';
export {
  loadSiglipTokenizer,
  SIGLIP_TOKENIZER_CACHE,
  SIGLIP_TOKENIZER_LOCAL_URL,
  SIGLIP_TOKENIZER_URL,
  SiglipTokenizer,
} from './inference/models/siglipText';
export type { TrOcrInput, TrOcrOutput } from './inference/models/trocr';
export {
  postprocessTrOcr,
  preprocessTrOcr,
  TROCR_INPUT_SIZE,
  TROCR_MAX_SEQUENCE_LENGTH,
  TROCR_TENSOR_SPEC,
  validateTrOcrInput,
} from './inference/models/trocr';
export type {
  ContrastPair,
  HarmonyPalette,
  PaletteAnalysis,
  PaletteAnalysisConfig,
  PalettePixelSource,
  PaletteResult,
  PaletteRole,
  PaletteSourceInfo,
  PaletteSwatch,
  PaletteTimingInfo,
  PaletteWarning,
} from './intelligence/paletteExtractor';
export {
  analogousHarmony,
  analyzePalette,
  complementaryHarmony,
  extractPalette,
  extractPaletteFromRgba,
  monochromaticHarmony,
  PALETTE_ANALYSIS_VERSION,
  PALETTE_DEFAULT_COLOR_COUNT,
  PALETTE_MAX_COLOR_COUNT,
  PALETTE_MIN_COLOR_COUNT,
  splitComplementaryHarmony,
  triadicHarmony,
} from './intelligence/paletteExtractor';
export type { SimplifiedPath } from './intelligence/pathSimplifier';
export {
  fitCubicBezier,
  simplifyPathRDP,
  simplifyToBezier,
} from './intelligence/pathSimplifier';
export type { DepthBlurOptions } from './lensBlur';
export {
  applyDepthBlur,
  applyLensBlur,
  depthToBlurWeight,
  depthToHeatmapImageData,
} from './lensBlur';
export * from './liveEffects';
export type {
  Lut1D,
  Lut3D,
  LutAdjustmentParams,
  LutInputSpace,
  LutInterpolation,
  LutMetadata,
  LutTransform,
  Shaper3D,
} from './lut';
export {
  applyLutToImageData,
  bakeFiltersToLut,
  CubeParseError,
  DEFAULT_LUT_INTERPOLATION,
  deserializeLutFromDocument,
  detectLutFormat,
  estimateLutMemoryUsage,
  exportLutToCube,
  fingerprintLut,
  LUT_FORMAT_LABELS,
  LUT_INPUT_SPACE_LABELS,
  LUT_SUPPORTED_EXTENSIONS,
  lutFormatSupports,
  MAX_LUT_TEXT_LENGTH,
  makeIdentityLut1D,
  makeIdentityLut3D,
  parse3dlData,
  parseCubeData,
  parseLutFile,
  sampleLut3D,
  sampleLut3DTetrahedral,
  sampleLut3DTrilinear,
  serializeLutForDocument,
} from './lut';
export type { EnhancedMaskOptions, MaskAlphaApplyOptions } from './maskCompositing';
export {
  acquireMaskSurface,
  applyMaskAlpha,
  applyMaskPostProcess,
  clearMaskSurfacePool,
  pixelToMaskAlpha,
  releaseMaskSurface,
  renderEnhancedMask,
  srgbToLuminance,
} from './maskCompositing';
export * from './media';
export type { MeshControlPoint, MeshTriangle, MeshWarp, MeshWarpCell } from './meshWarp';
export { createFlatMesh, renderWarpGrid, warpMesh, warpPath, warpPosition } from './meshWarp';
export type { ExifOrientation } from './metadata/exif';
export {
  applyExifOrientation,
  isValidExifOrientation,
  orientationAfterApply,
  parseExifOrientation,
} from './metadata/exif';
export type { PngChunkInfo, PngTextEntry } from './metadata/png';
export {
  buildPngChunk,
  canDeflate,
  insertPngIccp,
  insertPngTextChunks,
  isPng,
  readPngChunks,
  stripPngMetadata,
} from './metadata/png';
export type { MetadataContent, ResolveMetadataOptions } from './metadata/policy';
export {
  metadataToPngEntries,
  policyKeepsSensitiveData,
  resolveMetadataContent,
} from './metadata/policy';
export type { FitResult, MockupAlignX, MockupAlignY, MockupFitMode } from './mockup/fit';
export { fitRect, isFitEmpty } from './mockup/fit';
export type { Homography, Quad, Vec2 } from './mockup/homography';
export {
  applyHomography,
  invertHomography,
  isQuadConcave,
  isQuadSelfCrossing,
  isQuadValid,
  multiplyHomography,
  normalizeQuadCorners,
  quadBounds,
  solveHomography,
} from './mockup/homography';
export { mapQuadPoint, sampleBilinear, warpImageToQuad } from './mockup/quadWarp';
export type { NonSeparableMode } from './nonSeparable';
export {
  blendColorLch,
  blendColorW3C,
  blendHueLch,
  blendHueW3C,
  blendLuminosityLch,
  blendLuminosityW3C,
  blendNonSeparable,
  blendSaturationLch,
  blendSaturationW3C,
  clipColor,
  labToRgb,
  lchToRgb,
  lum,
  rgbToLab,
  rgbToLch,
  sat,
  setLum,
  setSat,
} from './nonSeparable';
export { getOcrModelConfig, validateDictionary } from './ocrPipeline/modelMetadata';
export {
  detectOrientationFromPixels,
  detectOrientationFromRegions,
  mapCoordsThroughRotation,
  rotateImageData,
} from './ocrPipeline/orientation';
// ── OCR (PaddleOCR v4) ───────────────────────────────────────────────
export { runOcrPipeline } from './ocrPipeline/pipeline';
export type {
  OcrModelConfig,
  OcrOptions,
  OcrResult,
  OcrWord,
  OrientationResult,
} from './ocrPipeline/types';
export type {
  OutlineWorkerError,
  OutlineWorkerProgress,
  OutlineWorkerRequest,
  OutlineWorkerResult,
  WorkerGlyphOutline,
} from './outlineWorker';
// Outline worker pool
export type {
  OutlineJob,
  OutlineJobResult,
  OutlinePoolConfig,
  PoolEvent,
  WorkerStatus,
} from './outlineWorkerPool';
export {
  destroyOutlineWorkerPool,
  getOutlineWorkerPool,
  OutlineWorkerPool,
} from './outlineWorkerPool';
export type { FillRule, PathShapeLike } from './pathCompound';
export { pathFillRule, pathRings } from './pathCompound';
export { expandStroke, offsetPath, roundCorners } from './pathOffset';
export type {
  GlyphPlacement,
  GlyphPlaceOptions,
  PathCluster,
  PathSample,
  PathSampler,
} from './pathText';
export {
  flattenShapedRuns,
  makePathSampler,
  pathLength,
  placeClustersOnPath,
  placeGlyphsOnPath,
  samplePathAtLength,
  transformPathShape,
} from './pathText';
export type { PixelArtAlgorithm, PixelArtOptions } from './pixelArtScaling';
export { scalePixelArt } from './pixelArtScaling';
export type { PorterDuffOp } from './porterDuff';
export {
  compositePixels,
  mapPorterDuffOp,
  porterDuffCompositing,
} from './porterDuff';
export { applyPosterize, type PosterizeParams } from './posterize';
export type { GradientPreset, TritonePreset } from './presets';
export { GRADIENT_MAP_PRESETS, TRITONE_PRESETS } from './presets';
export type { RasterEngine, RasterFormat, RasterOptions, RasterResult } from './raster';
export { computeOutputDimensions, estimateFileSize, renderRaster, supportsFormat } from './raster';
export type {
  ExportColorSpaceChoice,
  PixelBuffer,
  PixelBufferData,
  PixelBufferDescriptor,
  PixelBufferFormat,
  RasterColorTransform,
  RasterExportColorPolicy,
  RasterIccHeaderInfo,
} from './rasterColor';
export {
  BYTES_PER_PIXEL,
  buildMatrixProfile,
  convertExportImageData,
  convertImageDataTiled,
  convertPixelBufferFormat,
  createAnalyticRgbTransform,
  defaultTransferFor,
  EXPORT_COLOR_POLICIES,
  exportColorPolicyLabel,
  exportProfileBytes,
  float32ToHalfFloat,
  halfFloatToFloat32,
  identityTransform,
  insertJpegIccProfile,
  isWebp,
  isWithinPixelBudget,
  parseIccHeader,
  pixelBufferBytes,
  pixelFormatLabel,
  premultiplyRgba32f,
  profileDescriptionFor,
  resolveExportEncoding,
  rgba8ToRgba32f,
  rgba16ToRgba32f,
  rgba32fToRgba8,
  rgba32fToRgba16,
  transformDescriptor,
  unpremultiplyRgba32f,
  webpProfileEmbeddingSupported,
} from './rasterColor';
export type {
  FittedRasterDimensions,
  RasterCanvas,
  RasterCanvasContext,
  RasterSurface,
  RasterSurfacePolicy,
} from './rasterSurface';
export {
  createRasterSurface,
  DEFAULT_RASTER_SURFACE_POLICY,
  encodeRasterSurface,
  fitRasterDimensions,
} from './rasterSurface';
export type {
  RasterTraceFill,
  RasterTraceMode,
  RasterTraceOptions,
  RasterTracePath,
  RasterTracePoint,
  RasterTraceResult,
} from './rasterTrace';
export { quantizeExactPalette, quantizePalette, traceRasterToPaths } from './rasterTrace';
export type { EffectMaskResolver, ReplayColorOptions, ReplayTarget } from './replay';
export { primitiveBounds, renderAlphaMask, replayIr, resetGradientCacheForTest } from './replay';
export type {
  CapabilityStatus,
  RestorationCapability,
  RestorationErrorCode,
  RestorationOperation,
  RestorationPlan,
  RestorationRequest,
  RestorationRuntime,
  RestorationStagePlan,
  RestorationStageState,
  RestorationTask,
} from './restoration';
export {
  capabilitiesForTask,
  firstAvailableCapability,
  isRestorationErrorCode,
  isRestorationOperationAvailable,
  planRestoration,
  RESTORATION_CAPABILITIES,
  RESTORATION_ERROR_CODES,
  RestorationError,
  RestorationPlanningError,
  restorationTaskLabel,
  restorationTasksForOperation,
  toRestorationError,
} from './restoration';
export type {
  AutoAnalysis,
  AutoAnalysisSignal,
  RestorationSuggestion,
} from './restorationAuto';
export {
  analyzeImageForRestoration,
  recommendationLabel,
} from './restorationAuto';
export type {
  RestorationExecutionOptions,
  RestorationResult,
} from './restorationPipeline';
export { runRestoration } from './restorationPipeline';
export {
  buildBrushMask,
  clonePixels,
  createBrushMask,
  findBestPatch,
  healPixels,
  ncc,
  patchRegion,
  spotHeal,
} from './retouch';
export * from './richTextLayout';
export * from './semanticSimilarity';
export {
  itemNeedsAlphaShadow,
  paintAlphaAwareDropShadow,
  paintAlphaAwareInsetEffect,
  paintGeometricDropShadow,
  renderShadowSource,
  type ShadowOps,
} from './shadowSource';
export type { ShapeRichTextInput, ShapeRunInput } from './shaping';
// ── Text pipeline: shaping, BiDi, grapheme segmentation ──────────────────
export { hitTestCaret, scriptCodeToTag, shapeParagraphRuns, shapeRun, shapeText } from './shaping';
export type {
  NativeShapedRunPayload,
  ShapingBackend,
  ShapingBackendRequest,
  ShapingBackendResult,
} from './shapingBackend';
export {
  createHarfBuzzWasmBackend,
  normalizeNativeShapedRun,
} from './shapingBackend';
export type { ShapingCacheKeyOptions } from './shapingCache';
export { ShapingCache, shapingCache } from './shapingCache';
export * from './storyComposition';
export * from './text/lineBreak';
export * from './text/paragraphs';
export * from './text/visualOrder';
export * from './textLayout';
export * from './textLayoutSnapshot';
export type {
  EmbeddingRestriction,
  GlyphOutline,
  TextOutlineOptions,
  TextOutlineResult,
} from './textOutlines';
export { glyphOutlineToSvgPath, textOutlinesToSvg, textToOutlines } from './textOutlines';
export type { WarpedGlyphResult, WarpTextOptions, WarpTextResult } from './textWarpPipeline';
export { warpTextToMesh } from './textWarpPipeline';
export { applyThreshold, type ThresholdParams } from './threshold';
export type { ThumbnailOptions as LegacyThumbnailOptions } from './thumbnail';
export { renderThumbnail as legacyRenderThumbnail } from './thumbnail';
export type {
  ThumbnailBackground,
  ThumbnailCapabilities,
  ThumbnailFit,
  ThumbnailFormat,
  ThumbnailMetadata,
  ThumbnailOptions as UnifiedThumbnailOptions,
  ThumbnailResult,
  ThumbnailSource,
} from './thumbnail/index';
export {
  generateThumbnail,
  getThumbnailCapabilities,
  hasAnyCanvas,
  hasCreateImageBitmap,
  hasDomCanvas,
  hasFileReader,
  hasImageEncoding,
  hasOffscreenCanvas,
  hasWorkerSupport,
  setThumbnailCapabilitiesForTest,
  THUMBNAIL_RENDERER_VERSION,
} from './thumbnail/index';
export type { BezierFitOptions } from './traceBezierFit';
export { fitBezierToContour } from './traceBezierFit';
export { traceSceneNodeOutline } from './tracing';
export type { TritoneParams } from './tritone';
export { applyTritone, tritoneMap } from './tritone';
export type {
  Affine,
  ArrowheadStyle,
  Backend,
  BlendMode,
  Color,
  Effect,
  EngineColor,
  EngineFill,
  FillIR,
  FilterIR,
  GlyphAdjustmentIR,
  GradientInterpolationSpace,
  GradientTilingMode,
  HueInterpolation,
  PathPoint,
  Point,
  Primitive,
  RenderItem,
  Scene,
  SceneNode,
  Shape,
  ShapedGlyph,
  ShapedRun,
  Stroke,
  StrokeAlign,
  StrokeCap,
  StrokeJoin,
  TableCellIR,
  TableCellTextIR,
  TableShape,
  TextShaping,
} from './types';
export type { BidiClass, BidiDirection, BidiParagraph, BidiRun } from './unicode/bidi';
export {
  analyzeParagraph,
  autoParagraphDirection,
  bidiClassOf,
  logicalToVisual,
  reorderRuns,
  segmentRuns,
  visualToLogical,
} from './unicode/bidi';
export type { GraphemeBoundary } from './unicode/grapheme';
export {
  codepointOffset,
  graphemeBoundaries,
  graphemeCount,
  graphemeIndexAt,
  splitGraphemes,
  utf16IndexAtCodepointOffset,
  utf16IndexAtGrapheme,
} from './unicode/grapheme';
export type { ScriptCode, ScriptRun } from './unicode/script';
export { detectScript, dominantScript, segmentByScript } from './unicode/script';
export type { BoundaryBias, UnicodeIndexMap } from './unicode/unicodeIndices';
export {
  codePointCount,
  codePointToUtf16,
  createUnicodeIndexMap,
  graphemeToUtf16,
  normalizeGraphemeRange,
  snapUtf16Offset,
  utf16ToCodePoint,
  utf16ToGrapheme,
} from './unicode/unicodeIndices';
export type { UpscaleCapabilities } from './upscaleCapabilities';
export { detectUpscaleCapabilities } from './upscaleCapabilities';
export type { UpscaleModelMetadata } from './upscaleModels';
export { DEFAULT_UPSCALE_MODEL_ID, UPSCALE_MODELS } from './upscaleModels';
export type { UpscaleMode, UpscaleModeId } from './upscaleModes';
export { DEFAULT_UPSCALE_MODE, getUpscaleMode, UPSCALE_MODES } from './upscaleModes';
export { dispatchUpscale, UPSCALE_PROVIDER_CHAIN } from './upscaleProviders/dispatch';
export type {
  EnhancementPipelineOptions,
  EnhancementPipelineResult,
  EnhancementStage,
} from './upscaleProviders/enhancementPipeline';
export { runEnhancementPipeline } from './upscaleProviders/enhancementPipeline';
export { nativeUpscaleProvider } from './upscaleProviders/nativeProvider';
export {
  dispatchTrace,
  TRACE_PROVIDER_CHAIN,
  traceCapabilityReport,
} from './upscaleProviders/traceDispatch';
export type { TraceProvider, UpscaleProvider } from './upscaleProviders/types';
export { wasmTraceProvider } from './upscaleProviders/wasmTraceProvider';
export type {
  VideoEncodeCapabilities,
  VideoEncodeOptions,
  VideoEncodeResult,
  VideoEncoderProvider,
  VideoFrameSource,
} from './videoEncoder';
export {
  detectVideoCapabilities,
  encodeVideo,
} from './videoEncoder';
export type {
  VideoExportOptions,
  VideoExportResult,
  VideoExportSupport,
  VideoFrameRenderer,
  VideoTimelineRef,
} from './videoExport';
export {
  checkVideoExportSupport,
  computeVideoFrameCount,
  exportTimelineToVideo,
} from './videoExport';
export {
  ensureYuNetModel,
  ONNX_FACE_BACKEND_ID,
  ONNX_FACE_BACKEND_VERSION,
  OnnxFaceBackend,
  YU_NET_MODEL_ID,
  type YuNetFaceBackendOptions,
  yuNetLandmarksToAnchors,
} from './vision/backends/onnxFaceBackend';
export type { FaceAwareCropOptions, FaceAwareCropSuggestion } from './vision/cropSolver';
export { suggestFaceAwareCrop } from './vision/cropSolver';
export {
  type VisionErrorCode,
  VisionService,
  VisionServiceError,
  type VisionServiceOptions,
  type VisionServiceStats,
} from './vision/service';
export type {
  FaceAnchorName,
  FaceBoundsOutput,
  FaceDetection,
  FaceKeypointsOutput,
  HandLandmarksOutput,
  ObjectBoundsOutput,
  PoseLandmarksOutput,
  SegmentationOutput,
  VisionBackend,
  VisionBox,
  VisionCapability,
  VisionOutput,
  VisionOutputMap,
  VisionPoint,
  VisionPriority,
  VisionQuality,
  VisionRect,
  VisionRequest,
  VisionSource,
} from './vision/types';
export { VISION_CAPABILITIES, visionSourceKey } from './vision/types';
export * from './warp';
export type { WasmTraceModule } from './wasmLoader';
export { loadWasmEngineModule, prewarmWasmEngine, tryLoadTraceWasm } from './wasmLoader';
