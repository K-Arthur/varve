// COMPLEXITY: 32 — entry-point orchestrator. Must stay thin. All element
// logic lives in svg/elements.ts; shared utilities in svg/shared.ts.

/**
 * SVG parser — converts SVG XML into a Varve Document using a string-based
 * recursive descent approach (no DOMParser dependency).
 *
 * Research basis: SVG 1.1 (W3C Recommendation), Adobe Illustrator SVG export.
 */
import { createDocument } from '@varve/scene';
import { registerParser } from './registry';
import { convertElement } from './svg/elements';
import { collectDefs, parseSingleElement, parseUnit } from './svg/shared';
import type { ImportOptions, ImportParser, ImportResult } from './types';

export function parseSvg(svg: string, options?: Partial<ImportOptions>): ImportResult {
  const opts: ImportOptions = {
    embedImages: options?.embedImages ?? true,
    scale: options?.scale ?? 1,
    center: options?.center ?? false,
    keepPosition: options?.keepPosition ?? false,
  };

  const clean = svg.trim();
  const root = parseSingleElement(clean);
  if (root?.tag !== 'svg') {
    return {
      document: createDocument('Import'),
      nodeIds: [],
      warnings: ['No <svg> element found'],
    };
  }

  const warnings: string[] = [];
  const unsupported: string[] = [];
  let doc = createDocument('Imported SVG');
  const nodeIds: string[] = [];

  const vb = root.attrs.viewBox;
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      const [, , vw, vh] = parts;
      doc = { ...doc, canvasWidth: vw, canvasHeight: vh };
    }
  }

  if (root.attrs.width && root.attrs.height) {
    const w = parseUnit(root.attrs.width);
    const h = parseUnit(root.attrs.height);
    if (w && h) {
      doc = { ...doc, canvasWidth: w, canvasHeight: h };
    }
  }

  const defs = collectDefs(root);

  for (const child of root.children) {
    const { doc: d, ids } = convertElement(child, doc, defs, [], opts, warnings, unsupported);
    doc = d;
    nodeIds.push(...ids);
  }

  return {
    document: doc,
    nodeIds,
    warnings,
    ...(unsupported.length > 0 ? { unsupportedFeatures: [...new Set(unsupported)] } : {}),
  };
}

export { parseSvgColor } from './svg/shared';

export function createSvgParser(): ImportParser {
  return {
    format: 'svg',
    parse(data: string | Uint8Array, options?: Partial<ImportOptions>): ImportResult {
      const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
      return parseSvg(str, options);
    },
    supportedExtensions(): string[] {
      return ['svg', 'svgz'];
    },
    canParse(data: string | Uint8Array): boolean {
      const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
      return str.trim().startsWith('<svg') || str.trim().startsWith('<?xml');
    },
  };
}

registerParser(createSvgParser());
