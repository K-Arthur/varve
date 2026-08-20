import type { ImportOptions, ImportParser, ImportResult } from '../types';
import { convertFigmaSource } from './converter';
import { decodeFigmaSource, isFigmaJsonSource } from './source';

function options(value?: Partial<ImportOptions>): ImportOptions {
  return {
    embedImages: value?.embedImages ?? true,
    scale: value?.scale ?? 1,
    center: value?.center ?? false,
    keepPosition: value?.keepPosition ?? false,
  };
}

function unsupportedBinary(): ImportResult {
  return {
    document: {
      id: 'figma-import-failed',
      formatVersion: '2.20',
      name: 'Figma import failed',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    },
    nodeIds: [],
    warnings: [
      'This .fig file is an opaque native Figma binary. Varve does not reverse-engineer undocumented .fig bytes; export official Figma REST JSON or a plugin export package instead.',
    ],
    unsupportedFeatures: ['opaque native .fig binary'],
  };
}

export function createFigmaParser(): ImportParser {
  return {
    format: 'figma',
    supportedExtensions: () => ['fig', 'json'],
    canParse: isFigmaJsonSource,
    parse: (data, importOptions) => {
      if (!isFigmaJsonSource(data)) return unsupportedBinary();
      const result = convertFigmaSource(decodeFigmaSource(data));
      const opts = options(importOptions);
      if (opts.scale !== 1) {
        result.warnings.push(
          `Figma import scale ${opts.scale} is recorded as an import option; geometry scaling is not yet applied`,
        );
      }
      return result;
    },
  };
}

export { convertFigmaSource } from './converter';
export type {
  FigmaBounds,
  FigmaEffect,
  FigmaPaint,
  FigmaSourceComponent,
  FigmaSourceComponentSet,
  FigmaSourceDocument,
  FigmaSourceNode,
  FigmaSourcePage,
  FigmaSourceStyle,
  FigmaSourceVariable,
  FigmaExportSetting,
  FigmaLayoutGrid,
} from './source';
export { decodeFigmaSource, FIGMA_IMPORT_LIMITS, isFigmaJsonSource } from './source';
