export { createAiParser } from './ai';
export type { BatchImportOptions, BatchImportResult } from './batch';
export { batchImport } from './batch';
export { bytesToDataUrl, dataUrlToBytes, detectImageMime, getImageDimensions } from './bitmap';
export { createEpsParser } from './eps';
export { getBitmapInfo, importImageAsFill } from './image';
export { importFile, importImageFile, importSvgString } from './import';
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
export { createPdfParser } from './pdf';
export { createPsdParser } from './psd';
export { createSketchParser } from './sketch';
export {
  getParser,
  getParserForData,
  getParserForExtension,
  listSupportedFormats,
  registerParser,
  resetRegistry,
} from './registry';
export { createSvgParser, parseSvg } from './svg';
export type { BatchFileResult, ImportOptions, ImportParser, ImportResult } from './types';
export type { ImportValidation } from './validation';
export { validateImport } from './validation';

export const PACKAGE = '@strata/import' as const;

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
