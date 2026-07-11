import { type MeshWarp, warpPath } from './meshWarp';
import { textToOutlines } from './textOutlines';
import type { PathPoint } from './types';

export interface WarpTextOptions {
  text: string;
  fontData: ArrayBuffer;
  fontSize: number;
  fontFamily: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
  x?: number;
  y?: number;
}

export interface WarpedGlyphResult {
  char: string;
  points: PathPoint[];
  bounds: { x: number; y: number; w: number; h: number };
  advance: number;
}

export interface WarpTextResult {
  glyphs: WarpedGlyphResult[];
  bounds: { x: number; y: number; w: number; h: number };
  isPlaceholder: boolean;
}

/**
 * Warp text through a mesh deformation.
 *
 * Converts text to vector outlines (via opentype.js font parsing), then
 * warps each glyph's outline through the given mesh.
 */
export function warpTextToMesh(
  opts: WarpTextOptions,
  mesh: MeshWarp,
  srcW: number,
  srcH: number,
  tolerance: number = 1,
): WarpTextResult {
  const outlines = textToOutlines(opts.text, {
    fontSize: opts.fontSize,
    fontFamily: opts.fontFamily,
    fontWeight: opts.fontWeight,
    fontStyle: opts.fontStyle,
    letterSpacing: opts.letterSpacing,
    x: opts.x,
    y: opts.y,
    fontData: opts.fontData,
  });

  if (outlines.isPlaceholder) {
    return {
      glyphs: outlines.glyphs.map((g) => ({
        char: g.char,
        points: g.points,
        bounds: g.bounds,
        advance: g.advance,
      })),
      bounds: outlines.bounds,
      isPlaceholder: true,
    };
  }

  const warpedGlyphs: WarpedGlyphResult[] = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const glyph of outlines.glyphs) {
    const warpedPoints = warpPath(glyph.points, mesh, srcW, srcH, tolerance);

    let gMinX = Infinity,
      gMinY = Infinity,
      gMaxX = -Infinity,
      gMaxY = -Infinity;
    for (const p of warpedPoints) {
      if (p.x < gMinX) gMinX = p.x;
      if (p.y < gMinY) gMinY = p.y;
      if (p.x > gMaxX) gMaxX = p.x;
      if (p.y > gMaxY) gMaxY = p.y;
    }

    warpedGlyphs.push({
      char: glyph.char,
      points: warpedPoints,
      bounds: { x: gMinX, y: gMinY, w: gMaxX - gMinX, h: gMaxY - gMinY },
      advance: glyph.advance,
    });

    if (gMinX < minX) minX = gMinX;
    if (gMinY < minY) minY = gMinY;
    if (gMaxX > maxX) maxX = gMaxX;
    if (gMaxY > maxY) maxY = gMaxY;
  }

  return {
    glyphs: warpedGlyphs,
    bounds: {
      x: minX === Infinity ? 0 : minX,
      y: minY === Infinity ? 0 : minY,
      w: maxX === -Infinity ? 0 : maxX - minX,
      h: maxY === -Infinity ? 0 : maxY - minY,
    },
    isPlaceholder: false,
  };
}
