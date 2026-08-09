export { createAiParser } from './ai';
export type { BatchImportOptions, BatchImportResult } from './batch';
export { batchImport } from './batch';
export { bytesToDataUrl, dataUrlToBytes, detectImageMime, getImageDimensions } from './bitmap';
export * from './delimited';
export { createEpsParser } from './eps';
export * from './gradient';
export { getBitmapInfo, importImageAsFill } from './image';
export { importFile, importImageFile, importSvgString } from './import';
export { createPdfParser } from './pdf';
export { createPsdParser } from './psd';
export type { RasterInspection, RasterInspectionLimits } from './rasterInspection';
export {
  inspectRasterBytes,
  MAX_RASTER_DIMENSION,
  MAX_RASTER_ENCODED_BYTES,
  MAX_RASTER_PIXELS,
} from './rasterInspection';
export {
  getParser,
  getParserForData,
  getParserForExtension,
  listSupportedFormats,
  registerParser,
  resetRegistry,
} from './registry';
export type {
  FidelityIssue,
  ImportArtifact,
  ImportFileInput,
  ImportFileReport,
  ImportReport,
  ImportServiceOptions,
  ImportSource,
  UnsupportedFeature,
} from './service';
export { ImportService } from './service';
export { createSketchParser } from './sketch';
export { createSvgParser, parseSvg } from './svg';
export type { BatchFileResult, ImportOptions, ImportParser, ImportResult } from './types';
export type { ImportValidation } from './validation';
export { validateImport } from './validation';

export const PACKAGE = '@varve/import' as const;

import { createAiParser } from './ai';
import { createEpsParser } from './eps';
import { createPdfParser } from './pdf';
import { createPsdParser } from './psd';
// Auto-register all built-in parsers
import { registerParser } from './registry';
import { createSketchParser } from './sketch';
import { createSvgParser } from './svg';

registerParser(createSvgParser());
registerParser(createPdfParser());
registerParser(createPsdParser());
registerParser(createAiParser());
registerParser(createEpsParser());
registerParser(createSketchParser());
