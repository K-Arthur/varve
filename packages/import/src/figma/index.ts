import type { Document } from '@varve/scene';
import type { ImportOptions, ImportParser, ImportResult } from '../types';
import { convertFigmaSource, type FigmaConversionResult } from './converter';
import { decodeFigmaNativeSource, isFigmaNativeSource } from './native';
import { decodeFigmaSource, isFigmaJsonSource } from './source';

function options(value?: Partial<ImportOptions>): ImportOptions {
  return {
    embedImages: value?.embedImages ?? true,
    scale: value?.scale ?? 1,
    center: value?.center ?? false,
    keepPosition: value?.keepPosition ?? false,
  };
}

function nativeDecodeFailure(error: unknown): ImportResult {
  const message = error instanceof Error ? error.message : 'Unknown native .fig decoder error';
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
      `The native .fig file could not be decoded safely: ${message}`,
      'No changes were made to the destination document. Try exporting official Figma REST JSON or a plugin export package if this file uses an unsupported schema version.',
    ],
    unsupportedFeatures: ['native .fig decoding'],
  };
}

function scaleDocument(document: Document, factor: number): Document {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return document;
  const nodes = { ...document.nodes };
  const roots = new Set(document.pages?.map((page) => page.contentRoot) ?? document.rootChildren);
  for (const id of roots) {
    const node = nodes[id];
    if (!node) continue;
    const [a, b, c, d, e, f] = node.transform;
    nodes[id] = {
      ...node,
      transform: [a * factor, b * factor, c * factor, d * factor, e * factor, f * factor],
    } as typeof node;
  }
  return {
    ...document,
    nodes,
    canvasWidth: document.canvasWidth ? document.canvasWidth * factor : document.canvasWidth,
    canvasHeight: document.canvasHeight ? document.canvasHeight * factor : document.canvasHeight,
    pages: document.pages?.map((page) => ({
      ...page,
      width: page.width * factor,
      height: page.height * factor,
    })),
  };
}

export function createFigmaParser(): ImportParser {
  return {
    format: 'figma',
    supportedExtensions: () => ['fig', 'json'],
    canParse: (data) => isFigmaJsonSource(data) || isFigmaNativeSource(data),
    parse: (data, importOptions) => {
      const opts = options(importOptions);
      let result: FigmaConversionResult;
      if (isFigmaJsonSource(data)) {
        result = convertFigmaSource(decodeFigmaSource(data));
      } else if (isFigmaNativeSource(data) && data instanceof Uint8Array) {
        try {
          result = convertFigmaSource(decodeFigmaNativeSource(data));
        } catch (error) {
          return nativeDecodeFailure(error);
        }
      } else {
        return nativeDecodeFailure(new Error('Input is not a recognized Figma source'));
      }
      const document = scaleDocument(result.document, opts.scale);
      return document === result.document ? result : { ...result, document };
    },
  };
}

export { convertFigmaSource } from './converter';
export {
  decodeFigmaNativeSource,
  isFigmaNativeSource,
} from './native';
export type {
  FigmaBounds,
  FigmaEffect,
  FigmaExportSetting,
  FigmaLayoutGrid,
  FigmaPaint,
  FigmaSourceComponent,
  FigmaSourceComponentSet,
  FigmaSourceDocument,
  FigmaSourceNode,
  FigmaSourcePage,
  FigmaSourceStyle,
  FigmaSourceVariable,
} from './source';
export { decodeFigmaSource, FIGMA_IMPORT_LIMITS, isFigmaJsonSource } from './source';
