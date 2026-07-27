/**
 * @strata/engine — dual-backend renderer facade (Strata plan §0.3, ADR-0001).
 *
 * One TypeScript surface drives desktop (native Rust via Tauri IPC) and web
 * (wasm-pack of the same crates). Feature code never knows which backend it
 * is talking to. The render IR is replayed to canvas by `replayIr`.
 */

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
  DenoiseResult,
} from './denoiseProviders';
// ── Denoise (SCUNet) ─────────────────────────────────────────────────
export { dispatchDenoise, nativeDenoiseProvider, workerDenoiseProvider } from './denoiseProviders';
export type {
  DenoiseProvider,
  DenoiseTileRequest,
  DenoiseTileResult,
} from './denoiseProviders/types';
export { applyDuotone, type DuotoneParams } from './duotone';
export type { EffectContractEntry, QualityTier, WorkingSpace } from './effectContract';
export {
  anyLinearLightEffect,
  getEffectContract,
  getEffectContracts,
  requiresColorManagedPipeline,
} from './effectContract';
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
export { exportRasterizedSubtree, exportRasterizedSubtreeSync } from './exportRasterizedSubtree';
export { applyFilterWithCompositing, applySoftwareFilter } from './filterCompositor';
export type {
  Adjustment,
  AdjustmentBase,
  AdjustmentBlendMode,
  AdjustmentKind,
  BlackAndWhiteAdjustment,
  BlurAdjustment,
  BrightnessAdjustment,
  ChannelMixerAdjustment,
  ColorBalanceAdjustment,
  ColorBalanceTriplet,
  ColorHalftoneAdjustment,
  ContrastAdjustment,
  CurvesAdjustment,
  CurvesPoint,
  DuotoneAdjustment,
  ExposureAdjustment,
  GradientMapAdjustment,
  GradientMapStop,
  GrayscaleAdjustment,
  HalftoneAdjustment,
  HueRotateAdjustment,
  InvertAdjustment,
  LevelsAdjustment,
  LutAdjustment,
  OpacityAdjustment,
  PhotoFilterAdjustment,
  PosterizeAdjustment,
  SaturationAdjustment,
  SelectiveColorAdjustment,
  SepiaAdjustment,
  SharpenAdjustment,
  TemperatureAdjustment,
  ThresholdAdjustment,
  TintAdjustment,
  TritoneAdjustment,
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
  makeAdjustment,
} from './filters';
export * from './font';
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
  GradientMapParams,
  GradientMapStop as GradientMapFilterStop,
} from './gradientMap';
export { applyGradientMapFilter, buildGradientLUT } from './gradientMap';
export type { GrainAnchor, GrainSampleParams } from './grainSampler';
export {
  resolveGrainValue,
  resolveGrainValueSync,
  sampleImageGrain,
  sampleProceduralGrain,
} from './grainSampler';
export type {
  HalftoneChannel,
  HalftoneDotShape,
  HalftoneMethod,
  HalftoneParams,
  HalftonePattern,
} from './halftone';
export { applyBayerDithering, applyHalftone, BAYER_DEFAULT_SIZE, bayerMatrix } from './halftone';
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
export type { ImageCacheEntry, ImageLoadState } from './imageCache';
export { getImageCache, ImageCache, resetImageCache } from './imageCache';
export type {
  DenoiseStrength,
  UpscaleMethod,
  UpscaleOptions,
  UpscaleProgressFn,
} from './imageEnhancement';
export {
  computeUpscaleDimensions,
  DEFAULT_AI_UPSCALE_MODEL_ID,
  upscaleImageData,
} from './imageEnhancement';
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
export type {
  DownloadProgress,
  InferenceEvents,
  InferenceProvider,
  InferenceRequest,
  InferenceResult,
  ManagedSession,
  ModelInputSpec,
  ModelInstallInfo,
  ModelInstallSource,
  ModelManifestEntry,
  ModelState as InferenceModelState,
  ProviderChainOptions,
  RuntimeCapabilities,
} from './inference';
export {
  createDiagnosticsLabel,
  DownloadManager,
  disposeInferenceWorkerHost,
  getInferenceWorkerHost,
  getRuntimeCapabilities,
  InferenceError,
  InferenceWorkerHost,
  isInferenceError,
  listAllModels,
  ModelRegistry,
  resetRuntimeCapabilities,
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
export type {
  FontCandidate,
  FontDetectInput,
  FontDetectOutput,
} from './inference/models/fontDetect';
export {
  FONT_DETECT_INPUT_SIZE,
  FONT_DETECT_TENSOR_SPEC,
  heuristicFontMatch,
  preprocessFontDetect,
  validateFontDetectInput,
} from './inference/models/fontDetect';
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
export { normalizeEmbedding, rankBySimilarity } from './inference/models/siglip';
export type { TrOcrInput, TrOcrOutput } from './inference/models/trocr';
export {
  postprocessTrOcr,
  preprocessTrOcr,
  TROCR_INPUT_SIZE,
  TROCR_MAX_SEQUENCE_LENGTH,
  TROCR_TENSOR_SPEC,
  validateTrOcrInput,
} from './inference/models/trocr';
export type { HarmonyPalette, PaletteResult } from './intelligence/paletteExtractor';
export {
  analogousHarmony,
  complementaryHarmony,
  extractPalette,
  monochromaticHarmony,
  splitComplementaryHarmony,
  triadicHarmony,
} from './intelligence/paletteExtractor';
export type { SimplifiedPath } from './intelligence/pathSimplifier';
export {
  fitCubicBezier,
  simplifyPathRDP,
  simplifyToBezier,
} from './intelligence/pathSimplifier';
export { applyLensBlur, depthToBlurWeight, depthToHeatmapImageData } from './lensBlur';
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
export type { EnhancedMaskOptions } from './maskCompositing';
export {
  applyMaskPostProcess,
  pixelToMaskAlpha,
  renderEnhancedMask,
  srgbToLuminance,
} from './maskCompositing';
export type { MeshControlPoint, MeshTriangle, MeshWarp, MeshWarpCell } from './meshWarp';
export { createFlatMesh, renderWarpGrid, warpMesh, warpPath, warpPosition } from './meshWarp';
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
export type { GlyphPlacement, GlyphPlaceOptions, PathSample } from './pathText';
export { pathLength, placeGlyphsOnPath, samplePathAtLength } from './pathText';
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
export { quantizePalette, traceRasterToPaths } from './rasterTrace';
export type { ReplayTarget } from './replay';
export { primitiveBounds, renderAlphaMask, replayIr } from './replay';
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
export type { ShapeRichTextInput, ShapeRunInput } from './shaping';
// ── Text pipeline: shaping, BiDi, grapheme segmentation ──────────────────
export { hitTestCaret, scriptCodeToTag, shapeRun, shapeText } from './shaping';
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
export type { ThumbnailOptions } from './thumbnail';
export { renderThumbnail } from './thumbnail';
export type {
  ThumbnailBackground,
  ThumbnailCapabilities,
  ThumbnailFit,
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
  GradientTilingMode,
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
export type { WasmTraceModule } from './wasmLoader';
export { loadWasmEngineModule, prewarmWasmEngine, tryLoadTraceWasm } from './wasmLoader';
