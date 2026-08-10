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
  EXPORT_COLOR_POLICIES,
  type ExportColorSpaceChoice,
  exportColorPolicyLabel,
  exportProfileBytes,
  type RasterExportColorPolicy,
  resolveExportEncoding,
} from './exportPolicy';
export {
  BYTES_PER_PIXEL,
  isWithinPixelBudget,
  type PixelBufferDescriptor,
  type PixelBufferFormat,
  pixelBufferBytes,
  pixelFormatLabel,
  premultiplyRgba32f,
  rgba8ToRgba32f,
  rgba16ToRgba32f,
  rgba32fToRgba8,
  rgba32fToRgba16,
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
