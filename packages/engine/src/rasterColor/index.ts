/**
 * Raster colour management module (ADR-0217).
 *
 * Canonical encoding vocabulary, pixel buffer descriptors, analytic
 * conversion provider, deterministic ICC profile authoring/embedding, and
 * export helpers — the coherent colour-managed raster architecture shared
 * by import metadata, export, preflight and (future) display paths.
 */

export {
  DEFAULT_TILE_HEIGHT,
  identityTransform,
  createAnalyticRgbTransform,
  transformDescriptor,
  convertImageDataTiled,
  type RasterColorTransform,
} from './transform';
export {
  BYTES_PER_PIXEL,
  isWithinPixelBudget,
  pixelBufferBytes,
  pixelFormatLabel,
  premultiplyRgba32f,
  rgba16ToRgba32f,
  rgba32fToRgba16,
  rgba32fToRgba8,
  rgba8ToRgba32f,
  unpremultiplyRgba32f,
  type PixelBufferDescriptor,
  type PixelBufferFormat,
} from './pixelBuffer';
export {
  buildMatrixProfile,
  defaultTransferFor,
  parseIccHeader,
  profileDescriptionFor,
  type RasterIccHeaderInfo,
} from './profiles';
export {
  insertJpegIccProfile,
  isWebp,
  webpProfileEmbeddingSupported,
} from './embed';
export {
  convertExportImageData,
  exportColorPolicyLabel,
  exportProfileBytes,
  EXPORT_COLOR_POLICIES,
  resolveExportEncoding,
  type ExportColorSpaceChoice,
  type RasterExportColorPolicy,
} from './exportPolicy';
