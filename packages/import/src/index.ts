/**
 * @strata/import — foreign design file format importers.
 *
 * Supports SVG (full recursive descent parser), bitmap images (PNG/JPEG/WebP),
 * and an extensible format registry for additional parsers.
 *
 * Research basis: SVG 1.1 (W3C), PNG/JPEG/WebP binary header specs.
 */

export { bytesToDataUrl, dataUrlToBytes, getImageDimensions } from './bitmap';
export { getBitmapInfo, importImageAsFill } from './image';
export { importFile, importImageFile, importSvgString } from './import';
export {
  getParser,
  getParserForData,
  getParserForExtension,
  listSupportedFormats,
  registerParser,
} from './registry';
export { createSvgParser, parseSvg } from './svg';
export type { ImportOptions, ImportParser, ImportResult } from './types';

export const PACKAGE = '@strata/import' as const;
