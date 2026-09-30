import type { Document, PatternDefinition } from '@varve/scene';
import {
  forEachPatternInstance,
  type PatternRepeatParams,
  resolvePatternLattice,
} from '@varve/shared';
import { compilePatternPreview } from '../patterns/compilePatternPreview';

export interface PatternSupertileGeometry {
  width: number;
  height: number;
}

const RASTER_TILE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

/**
 * Export one reusable pattern cell as a portable SVG document.
 *
 * Vector definitions use the same compiled cell as the current editor
 * preview. Raster definitions embed their document asset bytes directly so
 * the SVG does not depend on a Varve asset ID, local file, or app cache.
 * Repeat layout is deliberately not expanded here: this is a source tile.
 */
export function exportPatternDefinitionTileSvg(
  document: Document,
  definition: PatternDefinition,
): string {
  const { width, height } = definition.cell;
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Pattern tile dimensions must be positive and finite.');
  }

  if (definition.source.kind === 'vector') {
    const preview = compilePatternPreview(document, definition);
    const svg = decodeSvgDataUrl(preview);
    if (/(?:href|xlink:href)\s*=\s*["'](?:https?:|file:|\/\/)/i.test(svg)) {
      throw new Error(
        'Pattern tile contains an external resource and cannot be exported portably.',
      );
    }
    return svg;
  }

  const dataUrl =
    definition.source.kind === 'raster'
      ? document.assets?.[definition.source.assetId]?.dataUrl
      : definition.previewRevision === definition.revision
        ? definition.previewSrc
        : undefined;
  if (!dataUrl) throw new Error('Pattern source is missing its embedded tile image.');

  const mime = /^data:([^;,]+)[;,]/i.exec(dataUrl)?.[1]?.toLowerCase();
  if (!mime || !RASTER_TILE_MIMES.has(mime)) {
    throw new Error('Pattern tile export supports embedded PNG, JPEG, WebP, GIF, or AVIF images.');
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${format(width)} ${format(height)}" width="${format(width)}" height="${format(height)}">`,
    `  <image href="${escapeXml(dataUrl)}" x="0" y="0" width="${format(width)}" height="${format(height)}" preserveAspectRatio="none" />`,
    '</svg>',
  ].join('\n');
}

/**
 * Export a rectangular repeating supercell for the supported lattice presets.
 * A single half-drop/brick motif cell is not itself a rectangular period; this
 * computes a true period, includes every source copy intersecting it, and clips
 * copies at the supercell boundary.
 */
export function exportPatternDefinitionSupertileSvg(
  document: Document,
  definition: PatternDefinition,
): string {
  const geometry = patternDefinitionSupertileGeometry(definition);
  const { width: tileWidth, height: tileHeight } = definition.cell;
  const sourceTileSvg = exportPatternDefinitionTileSvg(document, definition);
  const sourceHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sourceTileSvg)}`;
  const repeat = definition.repeat;
  const params: PatternRepeatParams = {
    tileWidth,
    tileHeight,
    gapX: repeat.gapX,
    gapY: repeat.gapY,
    arrangement: repeat.arrangement,
    rowShift: repeat.rowShift,
    columnShift: repeat.columnShift,
    mirrorX: repeat.mirrorX,
    mirrorY: repeat.mirrorY,
  };
  const lattice = resolvePatternLattice(params);
  if (!lattice) throw new Error('Pattern repeat geometry is invalid and cannot be exported.');

  const copies: string[] = [];
  const walk = forEachPatternInstance(
    lattice,
    { x: 0, y: 0, w: geometry.width, h: geometry.height },
    (_i, _j, matrix) => {
      copies.push(
        `<image href="${escapeXml(sourceHref)}" x="0" y="0" width="${format(tileWidth)}" height="${format(tileHeight)}" transform="matrix(${matrix.map(format).join(' ')})" preserveAspectRatio="none"/>`,
      );
    },
  );
  if (walk.truncated) {
    throw new Error('Pattern supertile exceeds the safe repeat instance limit.');
  }
  if (copies.length === 0) throw new Error('Pattern supertile contains no source artwork.');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${format(geometry.width)} ${format(geometry.height)}" width="${format(geometry.width)}" height="${format(geometry.height)}">`,
    `  <defs><clipPath id="pattern-supertile-clip" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="${format(geometry.width)}" height="${format(geometry.height)}"/></clipPath></defs>`,
    `  <g clip-path="url(#pattern-supertile-clip)">${copies.join('')}</g>`,
    '</svg>',
  ].join('\n');
}

/** Return the exact rectangular period for a supported built-in arrangement. */
export function patternDefinitionSupertileGeometry(
  definition: PatternDefinition,
): PatternSupertileGeometry {
  const { width: tileWidth, height: tileHeight } = definition.cell;
  if (![tileWidth, tileHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Pattern tile dimensions must be positive and finite.');
  }
  const { arrangement, gapX, gapY, rowShift, columnShift, mirrorX, mirrorY } = definition.repeat;
  const expectedShifts = {
    grid: [0, 0],
    'half-drop': [0, 0.5],
    brick: [0.5, 0],
  } as const;
  const expected = expectedShifts[arrangement];
  if (
    !expected ||
    !closeEnough(rowShift, expected[0]) ||
    !closeEnough(columnShift ?? 0, expected[1])
  ) {
    throw new Error(
      'This custom stagger does not have a supported rectangular SVG supertile. Reset the repeat to Grid, Half-drop, or Brick.',
    );
  }
  const stepX = tileWidth + gapX;
  const stepY = tileHeight + gapY;
  if (![stepX, stepY].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Pattern repeat periods must be positive and finite.');
  }

  switch (arrangement) {
    case 'grid':
      return {
        width: stepX * (mirrorX ? 2 : 1),
        height: stepY * (mirrorY ? 2 : 1),
      };
    case 'half-drop':
      // Two offset columns cancel one row of vertical phase. If rows mirror,
      // use four columns and two rows so both mirror parities also reset.
      return {
        width: stepX * (mirrorY ? 4 : 2),
        height: stepY * (mirrorY ? 2 : 1),
      };
    case 'brick':
      // Two offset rows cancel one column of horizontal phase. Alternating
      // column mirrors double that vertical period and the horizontal width.
      return {
        width: stepX * (mirrorX ? 2 : 1),
        height: stepY * (mirrorX ? 4 : 2),
      };
  }
}

function decodeSvgDataUrl(dataUrl: string): string {
  const match = /^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,(.*)$/is.exec(dataUrl);
  if (!match) throw new Error('Vector pattern preview is not an SVG tile.');
  const payload = match[1] ?? '';
  let svg: string;
  try {
    svg = /;base64,/i.test(dataUrl) ? atob(payload) : decodeURIComponent(payload);
  } catch {
    throw new Error('Vector pattern preview could not be decoded.');
  }
  if (!/^\s*<svg\b/i.test(svg)) throw new Error('Vector pattern preview is not a valid SVG tile.');
  return svg;
}

function format(value: number): string {
  return Number(value.toPrecision(12)).toString();
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function closeEnough(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9;
}
