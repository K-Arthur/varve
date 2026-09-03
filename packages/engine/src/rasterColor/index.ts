/**
 * Raster colour management module (ADR-0217).
 *
 * Canonical encoding vocabulary, pixel buffer descriptors, analytic
 * conversion provider, deterministic ICC profile authoring/embedding, and
 * export helpers — the coherent colour-managed raster architecture shared
 * by import metadata, export, preflight and (future) display paths.
 */

export {
  insertJpegIccProfile,
  isWebp,
  webpProfileEmbeddingSupported,
} from './embed';
export {
  convertExportImageData,
  DEFAULT_RASTER_EXPORT_SOURCE_ENCODING,
  EXPORT_COLOR_POLICIES,
  type ExportColorSpaceChoice,
  exportColorPolicyLabel,
  exportProfileBytes,
  type RasterExportColorPolicy,
  resolveExportEncoding,
} from './exportPolicy';
export {
  allocatePixelBuffer,
  BYTES_PER_PIXEL,
  type CmykaPixelBufferFormat,
  convertPixelBufferFormat,
  DEFAULT_PIXEL_BUFFER_BUDGET_BYTES,
  float32ToHalfFloat,
  halfFloatToFloat32,
  isCmykaPixelBufferFormat,
  isRgbaPixelBufferFormat,
  isWithinPixelBudget,
  type PixelBuffer,
  type PixelBufferData,
  type PixelBufferDescriptor,
  type PixelBufferFormat,
  pixelBufferBytes,
  pixelBufferChannelCount,
  pixelFormatLabel,
  premultiplyRgba32f,
  type RgbaPixelBufferFormat,
  rgba8ToRgba32f,
  rgba16fToRgba32f,
  rgba16ToRgba32f,
  rgba32fToRgba8,
  rgba32fToRgba16,
  rgba32fToRgba16f,
  unpremultiplyRgba32f,
} from './pixelBuffer';
export {
  buildMatrixProfile,
  defaultTransferFor,
  parseIccHeader,
  profileDescriptionFor,
  type RasterIccHeaderInfo,
} from './profiles';
export {
  convertImageDataTiled,
  createAnalyticRgbTransform,
  DEFAULT_TILE_HEIGHT,
  identityTransform,
  type RasterColorTransform,
  transformDescriptor,
} from './transform';
