// COMPLEXITY: 32 — entry-point orchestrator. Must stay thin. All element
// logic lives in svg/elements.ts; shared utilities in svg/shared.ts.

/**
 * SVG parser — converts SVG XML into a Varve Document using a string-based
 * recursive descent approach (no DOMParser dependency).
 *
 * Research basis: SVG 1.1 (W3C Recommendation), Adobe Illustrator SVG export.
 */
import { createDocument } from '@varve/scene';
import { Gunzip } from 'fflate';
import { registerParser } from './registry';
import { convertElement } from './svg/elements';
import {
  collectDefs,
  composeTransforms,
  MAX_SVG_SOURCE_BYTES,
  parseSingleElement,
  parseUnit,
} from './svg/shared';
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
  let rootTransforms: string[] = [];
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      const minX = parts[0] ?? Number.NaN;
      const minY = parts[1] ?? Number.NaN;
      const vw = parts[2] ?? Number.NaN;
      const vh = parts[3] ?? Number.NaN;
      if (
        Number.isFinite(minX) &&
        Number.isFinite(minY) &&
        Number.isFinite(vw) &&
        Number.isFinite(vh) &&
        vw > 0 &&
        vh > 0
      ) {
        const viewportWidth = root.attrs.width ? parseUnit(root.attrs.width) : null;
        const viewportHeight = root.attrs.height ? parseUnit(root.attrs.height) : null;
        const outputWidth = viewportWidth && viewportWidth > 0 ? viewportWidth : vw;
        const outputHeight = viewportHeight && viewportHeight > 0 ? viewportHeight : vh;
        const rawScaleX = outputWidth / vw;
        const rawScaleY = outputHeight / vh;
        const preserve = root.attrs.preserveAspectRatio?.trim() ?? 'xMidYMid meet';
        const preserveNone = preserve.split(/\s+/u)[0]?.toLowerCase() === 'none';
        const mode = preserve.split(/\s+/u)[1]?.toLowerCase() ?? 'meet';
        const scale =
          mode === 'slice' ? Math.max(rawScaleX, rawScaleY) : Math.min(rawScaleX, rawScaleY);
        const scaleX = preserveNone ? rawScaleX : scale;
        const scaleY = preserveNone ? rawScaleY : scale;
        const align = preserve.split(/\s+/u)[0]?.toLowerCase() ?? 'xmidymid';
        const alignX = align.includes('xmin')
          ? 0
          : align.includes('xmax')
            ? outputWidth - vw * scaleX
            : (outputWidth - vw * scaleX) / 2;
        const alignY = align.includes('ymin')
          ? 0
          : align.includes('ymax')
            ? outputHeight - vh * scaleY
            : (outputHeight - vh * scaleY) / 2;
        rootTransforms.push(
          `matrix(${scaleX},0,0,${scaleY},${alignX - minX * scaleX},${alignY - minY * scaleY})`,
        );
        doc = { ...doc, canvasWidth: outputWidth, canvasHeight: outputHeight };
      }
    }
  }

  if (root.attrs.width && root.attrs.height) {
    const w = parseUnit(root.attrs.width);
    const h = parseUnit(root.attrs.height);
    if (w && h) {
      doc = { ...doc, canvasWidth: w, canvasHeight: h };
    }
  }

  if (root.attrs.transform) rootTransforms.push(root.attrs.transform);
  // Keep this calculation explicit so malformed root transforms never make it
  // into the recursive converter as an unbounded or non-finite matrix.
  if (rootTransforms.length > 0) {
    const rootTransform = composeTransforms(rootTransforms);
    if (rootTransform.some((value) => !Number.isFinite(value))) {
      warnings.push('Root SVG transform was ignored because it is not finite');
      rootTransforms = [];
    }
  }

  const defs = collectDefs(root);

  for (const child of root.children) {
    const { doc: d, ids } = convertElement(
      child,
      doc,
      defs,
      rootTransforms,
      opts,
      warnings,
      unsupported,
    );
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

/** gzip magic — an .svgz is a gzipped .svg and decodes to nothing without this. */
function isGzip(data: Uint8Array): boolean {
  return data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * SVG source text, transparently un-gzipping `.svgz`. Extensions are
 * presentation data, so this sniffs the gzip magic rather than the filename:
 * an `.svgz` served as `.svg` still decodes, and a plain `.svg` is untouched.
 */
function svgText(data: string | Uint8Array): string {
  if (typeof data === 'string') return data;
  if (!isGzip(data)) return new TextDecoder().decode(data);
  if (data.byteLength > MAX_SVG_SOURCE_BYTES) return '';

  // Do not use gunzipSync here. Its output buffer is sized from the gzip
  // trailer before the parser has a chance to enforce its source budget, so a
  // tiny clipboard payload can otherwise request an arbitrarily large
  // allocation. Gunzip streams bounded chunks; abort as soon as the aggregate
  // decoded source exceeds the same limit used by parseSingleElement.
  const chunks: Uint8Array[] = [];
  let total = 0;
  let oversized = false;
  try {
    const gunzip = new Gunzip((chunk) => {
      total += chunk.byteLength;
      if (total > MAX_SVG_SOURCE_BYTES) {
        oversized = true;
        throw new Error('SVG source exceeds the decompression budget');
      }
      chunks.push(chunk);
    });
    gunzip.push(data, true);
    if (oversized) return '';
    const decoded = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      decoded.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(decoded);
  } catch {
    // Report through the normal "no <svg> element" path rather than throwing.
    return '';
  }
}

export function createSvgParser(): ImportParser {
  return {
    format: 'svg',
    parse(data: string | Uint8Array, options?: Partial<ImportOptions>): ImportResult {
      return parseSvg(svgText(data), options);
    },
    supportedExtensions(): string[] {
      return ['svg', 'svgz'];
    },
    canParse(data: string | Uint8Array): boolean {
      const str = svgText(data).trim();
      return str.startsWith('<svg') || str.startsWith('<?xml');
    },
  };
}

registerParser(createSvgParser());
