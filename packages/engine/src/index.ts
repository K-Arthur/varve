/**
 * @strata/engine — dual-backend renderer facade (Strata plan §0.3, ADR-0001).
 *
 * One TypeScript surface drives desktop (native Rust via Tauri IPC) and web
 * (wasm-pack of the same crates). Feature code never knows which backend it
 * is talking to. The render IR is replayed to canvas by `replayIr`.
 */

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
  solveTrimapMatting,
  TRIMap,
  terminateWorkerPool,
  trimapFromMask,
  workerModelIdForMethod,
} from './backgroundRemoval';
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
export { applyStyleOverrides, createEngine } from './engine';
export type { TileExportOpts } from './export';
export { getCanvasSizeLimit, tiledExport } from './export';
export { applyFilterWithCompositing, applySoftwareFilter } from './filterCompositor';
export type {
  Adjustment,
  AdjustmentBase,
  AdjustmentBlendMode,
  AdjustmentKind,
  BlurAdjustment,
  BrightnessAdjustment,
  ChannelMixerAdjustment,
  ColorBalanceAdjustment,
  ColorBalanceTriplet,
  ContrastAdjustment,
  CurvesAdjustment,
  CurvesPoint,
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
  SaturationAdjustment,
  SelectiveColorAdjustment,
  SepiaAdjustment,
  SharpenAdjustment,
  TemperatureAdjustment,
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
export type {
  ExportFontRequest,
  FontEntry,
  FontLoadState,
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
export type { ImageCacheEntry, ImageLoadState } from './imageCache';
export { getImageCache, ImageCache, resetImageCache } from './imageCache';
export type {
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
} from './inference';
export { ModelRegistry, runProviderChain, SessionManager } from './inference';
export type { UpscaleMethod, UpscaleOptions } from './imageEnhancement';
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
  LUT_FORMAT_LABELS,
  LUT_INPUT_SPACE_LABELS,
  LUT_SUPPORTED_EXTENSIONS,
  lutFormatSupports,
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
export type { FillRule, PathShapeLike } from './pathCompound';
export { pathFillRule, pathRings } from './pathCompound';
export type { GlyphPlacement, GlyphPlaceOptions, PathSample } from './pathText';
export { pathLength, placeGlyphsOnPath, samplePathAtLength } from './pathText';
export type { PorterDuffOp } from './porterDuff';
export {
  compositePixels,
  mapPorterDuffOp,
  porterDuffCompositing,
} from './porterDuff';
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
export type { GlyphOutline, TextOutlineOptions, TextOutlineResult } from './textOutlines';
export { glyphOutlineToSvgPath, textOutlinesToSvg, textToOutlines } from './textOutlines';
export type { WarpedGlyphResult, WarpTextOptions, WarpTextResult } from './textWarpPipeline';
export { warpTextToMesh } from './textWarpPipeline';
export type { ThumbnailOptions } from './thumbnail';
export { renderThumbnail } from './thumbnail';
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
export type { UpscaleModelMetadata } from './upscaleModels';
export { DEFAULT_UPSCALE_MODEL_ID, UPSCALE_MODELS } from './upscaleModels';
export { dispatchUpscale, UPSCALE_PROVIDER_CHAIN } from './upscaleProviders/dispatch';
export { nativeUpscaleProvider } from './upscaleProviders/nativeProvider';
export {
  dispatchTrace,
  TRACE_PROVIDER_CHAIN,
} from './upscaleProviders/traceDispatch';
export type { TraceProvider, UpscaleProvider } from './upscaleProviders/types';
export { wasmTraceProvider } from './upscaleProviders/wasmTraceProvider';
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
export {
  createWasmEngineFromModule,
  loadWasmEngineModule,
  prewarmWasmEngine,
  tryLoadTraceWasm,
  tryWasmEngine,
} from './wasmLoader';
