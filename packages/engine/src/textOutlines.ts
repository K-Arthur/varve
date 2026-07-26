/**
 * Text-to-outlines conversion utility.
 *
 * Converts editable text into vector path representations. Uses opentype.js
 * for real glyph path extraction when font binary data is provided; falls back
 * to bounding-box placeholder outlines when it is not.
 *
 * SHAPING NOTE:
 *   This module extracts glyph OUTLINES from font binary data using opentype.js.
 *   It does NOT perform text shaping (ligatures, GSUB/GPOS, complex-script
 *   reordering). The caller is responsible for providing CORRECT positions via
 *   the shaping pipeline (Canvas2D measureText or HarfBuzz). Positions from the
 *   shaping pipeline are correct because the browser's native text engine
 *   applies GSUB/GPOS; this module provides the glyph shapes at those positions.
 *
 *   Limitation: without glyph IDs from the shaper, we look up glyphs by
 *   character code (font.charToGlyph). For ligatures and complex scripts, the
 *   glyph shape may differ from what the shaper substituted. This is a known
 *   ceiling on correctness for the browser-only path — the native Rust backend
 *   (rustybuzz + ab_glyph) will provide true glyph-ID-based outlining.
 *
 * Known limitations:
 *   - Ligatures, combining marks, RTL scripts, and Indic/Arabic shaping are
 *     NOT supported at the glyph-lookup level. Positions from the shaper are
 *     correct, but the extracted glyph shapes match the raw character-to-glyph
 *     mapping, which may differ from the shaped glyphs.
 *   - Variable fonts: outlines reflect the glyph shapes at the requested axis
 *     coordinates (via opentype.js font.variation.set()).
 *   - Color fonts (COLR/CPAL, CBDT, SVG-in-OpenType): detected and reported;
 *     outlining is refused with an appropriate message.
 *
 * Research basis: Figma "Outline text", Illustrator "Create Outlines",
 * opentype.js glyph path extraction, ab_glyph Rust crate.
 */

import { parse as parseOpentypeBuffer } from 'opentype.js';
import type { PathPoint } from './types';

/** A single glyph outline represented as a series of path points. */
export interface GlyphOutline {
  char: string;
  /** Path points describing the glyph outline (bezier-compatible).
   *  Contains all subpaths (outer contour + holes) concatenated. */
  points: PathPoint[];
  /** Individual path rings (subpaths) for compound path construction.
   *  ring[0] = outer contour, ring[1..n] = holes (counters). */
  rings: PathPoint[][];
  /** Bounding box of the glyph. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Advance width to the next glyph. */
  advance: number;
}

/** Result of converting text to outlines. */
export interface TextOutlineResult {
  /** One outline per character in the input text. */
  glyphs: GlyphOutline[];
  /** Total bounds of all glyphs. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Whether the outlines are real glyph paths (true) or bounding-box placeholders (false). */
  isPlaceholder: boolean;
  /** Warnings generated during outlining (e.g., licensing issues). */
  warnings: string[];
  /** Whether the font has color glyphs that were not outlined. */
  hasColorGlyphs: boolean;
  /** Whether the font has restricted embedding rights. */
  restrictedEmbedding: boolean;
}

export interface TextOutlineOptions {
  fontSize: number;
  fontFamily: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
  /** X origin for the text. */
  x?: number;
  /** Y origin (baseline) for the text. */
  y?: number;
  /** Font binary data (TTF/OTF/WOFF) for real glyph extraction via opentype.js. */
  fontData?: ArrayBuffer;
  /** Variable font axis coordinates (e.g. { wght: 700, wdth: 75 }). */
  variableAxes?: Record<string, number>;
}

/** Cubic bezier command from opentype.js. */
interface OTCubicCurve {
  type: 'C';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x: number;
  y: number;
}

/** Quadratic bezier command from opentype.js. */
interface OTQuadCurve {
  type: 'Q';
  x1: number;
  y1: number;
  x: number;
  y: number;
}

/** Line command from opentype.js. */
interface OTLine {
  type: 'L';
  x: number;
  y: number;
}

/** Move command from opentype.js. */
interface OTMove {
  type: 'M';
  x: number;
  y: number;
}

/** Close command from opentype.js. */
interface OTClose {
  type: 'Z';
}

type OTCommand = OTCubicCurve | OTQuadCurve | OTLine | OTMove | OTClose;

/**
 * Convert text to vector outlines.
 *
 * When `options.fontData` is provided (an ArrayBuffer of a TTF/OTF/WOFF font),
 * uses opentype.js to extract real glyph bezier paths. Otherwise produces
 * bounding-box placeholder rectangles, matching the previous behavior.
 */
export function textToOutlines(text: string, options: TextOutlineOptions): TextOutlineResult {
  const fs = options.fontSize;
  const ls = options.letterSpacing ?? 0;
  const x0 = options.x ?? 0;
  const y0 = options.y ?? 0;

  if (options.fontData) {
    return extractWithOpentype(text, options.fontData, fs, ls, x0, y0, options.variableAxes);
  }

  return {
    ...placeholderOutlines(text, fs, ls, x0, y0),
    warnings: [],
    hasColorGlyphs: false,
    restrictedEmbedding: false,
  };
}

/** Classification of font embedding rights from OS/2 fsType. */
export type EmbeddingRestriction =
  | 'installable'
  | 'preview-and-print'
  | 'editable'
  | 'restricted'
  | 'no-subsetting'
  | 'unknown';

function placeholderOutlines(
  text: string,
  fontSize: number,
  letterSpacing: number,
  x0: number,
  y0: number,
): TextOutlineResult {
  const glyphs: GlyphOutline[] = [];
  let cursorX = x0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? '';
    if (char === '\n') {
      cursorX = x0;
      continue;
    }

    const advance = estimateGlyphAdvance(char, fontSize);
    const glyphW = advance;
    const glyphH = fontSize;
    const glyphY = y0 - fontSize * 0.8;

    const points: PathPoint[] = [
      { x: cursorX, y: glyphY, handleIn: null, handleOut: null },
      { x: cursorX + glyphW, y: glyphY, handleIn: null, handleOut: null },
      { x: cursorX + glyphW, y: glyphY + glyphH, handleIn: null, handleOut: null },
      { x: cursorX, y: glyphY + glyphH, handleIn: null, handleOut: null },
    ];

    glyphs.push({
      char,
      points,
      rings: [points],
      bounds: { x: cursorX, y: glyphY, w: glyphW, h: glyphH },
      advance,
    });
    cursorX += advance + letterSpacing;
  }

  return {
    glyphs,
    bounds: { x: x0, y: y0 - fontSize, w: cursorX - x0, h: fontSize * 1.2 },
    isPlaceholder: true,
    warnings: [],
    hasColorGlyphs: false,
    restrictedEmbedding: false,
  };
}

function extractWithOpentype(
  text: string,
  fontData: ArrayBuffer,
  fontSize: number,
  letterSpacing: number,
  x0: number,
  y0: number,
  variableAxes?: Record<string, number>,
): TextOutlineResult {
  const font = parseOpentypeFont(fontData);
  const warnings: string[] = [];

  // Check for color glyphs (COLR/CPAL, SVG-in-OpenType, CBDT, sbix)
  if (hasColorGlyphs(font)) {
    return {
      glyphs: [],
      bounds: { x: 0, y: 0, w: 0, h: 0 },
      isPlaceholder: true,
      warnings: [
        'This font contains color glyphs (COLR/CPAL, SVG-in-OpenType, or bitmap). ' +
          'Color font outlining is not supported. Use a monochrome font instead.',
      ],
      hasColorGlyphs: true,
      restrictedEmbedding: false,
    };
  }

  // Check embedding rights
  const embeddingRights = getEmbeddingRights(font);
  const restrictedEmbedding =
    embeddingRights === 'restricted' || embeddingRights === 'preview-and-print';
  if (restrictedEmbedding) {
    warnings.push(
      `Font embedding rights (fsType=${embeddingRights}) may restrict outlining. ` +
        'Proceed with caution; redistribution may require a license.',
    );
  }

  // Apply variable font axis coordinates if provided
  if (variableAxes && Object.keys(variableAxes).length > 0 && isVariableFont(font)) {
    try {
      font.variation.set(variableAxes);
    } catch {
      warnings.push('Failed to set variable font axes; using default instance.');
    }
  }

  const scale = fontSize / font.unitsPerEm;
  const glyphs: GlyphOutline[] = [];
  let cursorX = x0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? '';
    if (char === '\n') {
      cursorX = x0;
      continue;
    }

    // Get the opentype.js glyph
    const glyph = font.charToGlyph(char);
    const advance = glyph.advanceWidth * scale;

    // Extract path commands and split into rings (subpaths)
    const path = glyph.getPath(0, 0, fontSize);
    const commands = (path as unknown as { commands: OTCommand[] }).commands;

    const rings = commandsToRings(commands);
    const allPoints = rings.flat();
    const bounds = computeBounds(allPoints);

    // Translate all points by cursor position
    const translatedRings = rings.map((ring) => translatePoints(ring, cursorX, y0));
    const translatedPoints = translatedRings.flat();

    glyphs.push({
      char,
      points: translatedPoints,
      rings: translatedRings,
      bounds: {
        x: cursorX + bounds.x,
        y: y0 + bounds.y,
        w: bounds.w,
        h: bounds.h,
      },
      advance,
    });

    cursorX += advance + letterSpacing;
  }

  return {
    glyphs,
    bounds: {
      x: x0,
      y: y0 - fontSize * 1.2,
      w: cursorX - x0,
      h: fontSize * 1.5,
    },
    isPlaceholder: false,
    warnings,
    hasColorGlyphs: false,
    restrictedEmbedding,
  };
}

function parseOpentypeFont(data: ArrayBuffer) {
  return parseOpentypeBuffer(data) as unknown as {
    unitsPerEm: number;
    charToGlyph: (char: string) => {
      advanceWidth: number;
      getPath: (
        x: number,
        y: number,
        size: number,
        options?: { variation?: Record<string, number> },
      ) => { commands: OTCommand[] };
      path: { unitsPerEm: number };
    };
    glyphs: { length: number };
    variation: {
      set: (coords: Record<string, number>) => void;
      get: () => Record<string, number>;
    };
    tables: {
      OS2?: { fsType?: number };
      COLR?: unknown;
      CPAL?: unknown;
      SVG?: unknown;
      CBDT?: unknown;
      sbix?: unknown;
    };
    defaultRenderOptions: { variation: Record<string, number> };
  };
}

/** Check if a font contains color glyphs. */
function hasColorGlyphs(font: ReturnType<typeof parseOpentypeFont>): boolean {
  return !!(font.tables.COLR || font.tables.SVG || font.tables.CBDT || font.tables.sbix);
}

/** Check if a font is variable (has fvar table). */
function isVariableFont(font: ReturnType<typeof parseOpentypeFont>): boolean {
  return typeof font.variation?.set === 'function';
}

/** Extract fsType embedding rights from the OS/2 table. */
function getEmbeddingRights(font: ReturnType<typeof parseOpentypeFont>): EmbeddingRestriction {
  const fsType = font.tables.OS2?.fsType;
  if (fsType === undefined) return 'unknown';
  const embeddingBits = fsType & 0x000c;
  const noSubsetting = (fsType & 0x0100) !== 0;
  if (noSubsetting) return 'no-subsetting';
  if (embeddingBits === 0) return 'installable';
  if (embeddingBits === 0x0004) return 'preview-and-print';
  if (embeddingBits === 0x0008) return 'editable';
  return 'restricted';
}

/**
 * Split OpenType path commands into separate path rings (subpaths).
 * Each M command starts a new subpath. ring[0] is the outer contour;
 * subsequent rings are holes (counters).
 */
function commandsToRings(commands: OTCommand[]): PathPoint[][] {
  const rings: PathPoint[][] = [];
  let currentRing: PathPoint[] = [];
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  function pushPoint(pt: PathPoint): void {
    currentRing.push(pt);
    lastX = pt.x;
    lastY = pt.y;
  }

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': {
        if (currentRing.length > 0) {
          rings.push(currentRing);
          currentRing = [];
        }
        startX = cmd.x;
        startY = cmd.y;
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case 'L': {
        pushPoint({ x: cmd.x, y: cmd.y, handleIn: null, handleOut: null });
        break;
      }
      case 'C': {
        const prev =
          currentRing.length > 0
            ? currentRing[currentRing.length - 1]!
            : {
                x: lastX,
                y: lastY,
                handleIn: null as [number, number] | null,
                handleOut: null as [number, number] | null,
              };
        if (currentRing.length > 0) {
          currentRing[currentRing.length - 1] = {
            ...prev,
            handleOut: [cmd.x1 - prev.x, cmd.y1 - prev.y] as [number, number],
          } as PathPoint;
        }
        const newPt: PathPoint = {
          x: cmd.x,
          y: cmd.y,
          handleIn: [cmd.x2 - cmd.x, cmd.y2 - cmd.y] as [number, number],
          handleOut: null,
        };
        pushPoint(newPt);
        break;
      }
      case 'Q': {
        const prev =
          currentRing.length > 0
            ? currentRing[currentRing.length - 1]!
            : {
                x: lastX,
                y: lastY,
                handleIn: null as [number, number] | null,
                handleOut: null as [number, number] | null,
              };
        const c1x = lastX + (2 / 3) * (cmd.x1 - lastX);
        const c1y = lastY + (2 / 3) * (cmd.y1 - lastY);
        const c2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x);
        const c2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y);
        if (currentRing.length > 0) {
          currentRing[currentRing.length - 1] = {
            ...prev,
            handleOut: [c1x - prev.x, c1y - prev.y] as [number, number],
          } as PathPoint;
        }
        const newPt: PathPoint = {
          x: cmd.x,
          y: cmd.y,
          handleIn: [c2x - cmd.x, c2y - cmd.y] as [number, number],
          handleOut: null,
        };
        pushPoint(newPt);
        break;
      }
      case 'Z': {
        pushPoint({ x: startX, y: startY, handleIn: null, handleOut: null });
        break;
      }
    }
  }

  if (currentRing.length > 0) {
    rings.push(currentRing);
  }

  return rings;
}

function computeBounds(points: PathPoint[]): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function translatePoints(points: PathPoint[], dx: number, dy: number): PathPoint[] {
  return points.map((p) => ({
    x: p.x + dx,
    y: p.y + dy,
    handleIn: p.handleIn ? ([p.handleIn[0], p.handleIn[1]] as [number, number]) : null,
    handleOut: p.handleOut ? ([p.handleOut[0], p.handleOut[1]] as [number, number]) : null,
  }));
}

/** Estimate glyph advance width without a real font. */
function estimateGlyphAdvance(char: string, fontSize: number): number {
  if (char === ' ') return fontSize * 0.3;
  if (char === '\t') return fontSize * 1.2;
  if (char.charCodeAt(0) > 0x4e00 && char.charCodeAt(0) < 0x9fff) return fontSize * 1.0;
  return fontSize * 0.6;
}

/**
 * Convert a GlyphOutline to an SVG path string.
 * For bezier curves, emits C commands; for straight segments, L commands.
 */
export function glyphOutlineToSvgPath(glyph: GlyphOutline): string {
  const pts = glyph.points;
  if (pts.length === 0) return '';

  let path = `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const p = pts[i]!;

    if (prev.handleOut && p.handleIn) {
      const c1x = prev.x + prev.handleOut[0];
      const c1y = prev.y + prev.handleOut[1];
      const c2x = p.x + p.handleIn[0];
      const c2y = p.y + p.handleIn[1];
      path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    } else if (prev.handleOut) {
      const c1x = prev.x + prev.handleOut[0];
      const c1y = prev.y + prev.handleOut[1];
      path += ` Q ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    } else if (p.handleIn) {
      const c2x = p.x + p.handleIn[0];
      const c2y = p.y + p.handleIn[1];
      path += ` Q ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    } else {
      path += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    }
  }
  path += ' Z';
  return path;
}

/**
 * Convert a full TextOutlineResult to an SVG `<g>` element string.
 */
export function textOutlinesToSvg(
  result: TextOutlineResult,
  fill: string = 'currentColor',
): string {
  const paths = result.glyphs
    .map((g) => `  <path d="${glyphOutlineToSvgPath(g)}" fill="${fill}"/>`)
    .join('\n');
  return `<g>\n${paths}\n</g>`;
}
