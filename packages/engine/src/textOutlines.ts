/**
 * Text-to-outlines conversion utility.
 *
 * Converts editable text into vector path representations. Uses opentype.js
 * for real glyph path extraction when font binary data is provided; falls back
 * to bounding-box placeholder outlines when it is not.
 *
 * Known limitations:
 *   - Simple glyph-lookup only (no complex-script shaping). Ligatures,
 *     combining marks, RTL scripts, and Indic/Arabic shaping are NOT supported.
 *     The extracted outlines match the raw glyph advances from the font, which
 *     is correct for Latin/Cyrillic scripts but will produce incorrect results
 *     for complex scripts.
 *   - Variable font instances: the outlines reflect the font's default glyph
 *     shapes. Variable-axis-dependent outline changes (e.g., weight-dependent
 *     stroke contours) are not reflected unless the font data at the specific
 *     axis values is provided.
 *
 * Research basis: Figma "Outline text", Illustrator "Create Outlines",
 * opentype.js glyph path extraction, ab_glyph Rust crate.
 */

import { parse as parseOpentypeBuffer } from 'opentype.js';
import type { PathPoint } from './types';

/** A single glyph outline represented as a series of path points. */
export interface GlyphOutline {
  char: string;
  /** Path points describing the glyph outline (bezier-compatible). */
  points: PathPoint[];
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
    return extractWithOpentype(text, options.fontData, fs, ls, x0, y0);
  }

  return placeholderOutlines(text, fs, ls, x0, y0);
}

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
      bounds: { x: cursorX, y: glyphY, w: glyphW, h: glyphH },
      advance,
    });
    cursorX += advance + letterSpacing;
  }

  return {
    glyphs,
    bounds: { x: x0, y: y0 - fontSize, w: cursorX - x0, h: fontSize * 1.2 },
    isPlaceholder: true,
  };
}

function extractWithOpentype(
  text: string,
  fontData: ArrayBuffer,
  fontSize: number,
  letterSpacing: number,
  x0: number,
  y0: number,
): TextOutlineResult {
  const font = parseOpentypeFont(fontData);
  const scale = fontSize / font.unitsPerEm;
  const glyphs: GlyphOutline[] = [];
  let cursorX = x0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? '';
    if (char === '\n') {
      cursorX = x0;
      continue;
    }

    const glyph = font.charToGlyph(char);
    const advance = glyph.advanceWidth * scale;
    const path = glyph.getPath(0, 0, fontSize);
    const commands = (path as unknown as { commands: OTCommand[] }).commands;

    const points = commandsToPathPoints(commands);
    const bounds = computeBounds(points);
    const translated = translatePoints(points, cursorX, y0);

    glyphs.push({
      char,
      points: translated,
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
  };
}

function parseOpentypeFont(data: ArrayBuffer) {
  return parseOpentypeBuffer(data) as {
    unitsPerEm: number;
    charToGlyph: (char: string) => {
      advanceWidth: number;
      getPath: (x: number, y: number, size: number) => { commands: OTCommand[] };
    };
    glyphs: { length: number };
  };
}

function commandsToPathPoints(commands: OTCommand[]): PathPoint[] {
  const points: PathPoint[] = [];
  let startX = 0,
    startY = 0;
  let lastX = 0,
    lastY = 0;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': {
        startX = cmd.x;
        startY = cmd.y;
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case 'L': {
        points.push({ x: cmd.x, y: cmd.y, handleIn: null, handleOut: null });
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case 'C': {
        const prev =
          points.length > 0
            ? points[points.length - 1]!
            : { x: lastX, y: lastY, handleIn: null, handleOut: null };
        if (points.length > 0 && points[points.length - 1] === prev) {
          points[points.length - 1] = {
            ...prev,
            handleOut: [cmd.x1 - prev.x, cmd.y1 - prev.y] as [number, number],
          };
        }
        const newPt: PathPoint = {
          x: cmd.x,
          y: cmd.y,
          handleIn: [cmd.x2 - cmd.x, cmd.y2 - cmd.y] as [number, number],
          handleOut: null,
        };
        points.push(newPt);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case 'Q': {
        const prev =
          points.length > 0
            ? points[points.length - 1]!
            : { x: lastX, y: lastY, handleIn: null, handleOut: null };
        const c1x = lastX + (2 / 3) * (cmd.x1 - lastX);
        const c1y = lastY + (2 / 3) * (cmd.y1 - lastY);
        const c2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x);
        const c2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y);
        if (points.length > 0 && points[points.length - 1] === prev) {
          points[points.length - 1] = {
            ...prev,
            handleOut: [c1x - prev.x, c1y - prev.y] as [number, number],
          };
        }
        const newPt: PathPoint = {
          x: cmd.x,
          y: cmd.y,
          handleIn: [c2x - cmd.x, c2y - cmd.y] as [number, number],
          handleOut: null,
        };
        points.push(newPt);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case 'Z': {
        points.push({ x: startX, y: startY, handleIn: null, handleOut: null });
        lastX = startX;
        lastY = startY;
        break;
      }
    }
  }

  return points;
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
