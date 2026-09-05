/**
 * Canonical text geometry for text nodes.
 *
 * One derived layout, consumed by scene bounds, the render IR, hit testing,
 * the selection overlay, and the editing textarea. Before this module each of
 * those measured text its own way — `nodeBounds` with a 0.6em-per-character
 * estimate, `sourceBounds` with a second copy of the same, `sceneToEngine`
 * with `text.length * fontSize * 0.55`, overlays with `length * 0.6` — so the
 * same string had one geometry when rendered, another when selected, and a
 * third while being edited.
 *
 * Three rectangles are distinct and must not be conflated:
 *
 * - **Container bounds** — the box the user defined (`w`/`h`). Only area and
 *   fixed text have one; it is document data and is never derived.
 * - **Layout bounds** — the union of the line boxes after explicit breaks and
 *   soft wrapping. Derived, and it moves when a font becomes usable.
 * - **Selection/transform bounds** — what the editor shows and transforms.
 *   Which of the two above it equals depends on the resizing mode, which is
 *   the whole point of the mode matrix below.
 *
 * | Mode         | Width source        | Height source       | Overflow          |
 * | ------------ | ------------------- | ------------------- | ----------------- |
 * | `autoWidth`  | widest line box     | all line boxes      | none — box grows  |
 * | `autoHeight` | container `w`       | wrapped line boxes  | none — box grows  |
 * | `fixed`      | container `w`       | container `h`       | `textOverflow`    |
 * | `path`       | caller (path-derived) | caller            | path length       |
 *
 * `w`/`h` are container geometry, never a cached content measurement. An
 * `autoWidth` node that carries a stale `h` from an earlier single-line state
 * (imports and older documents both produce these) must not be frozen at one
 * line by it — which is exactly what made multi-line selection boxes cover
 * only the first line.
 */

import { type MeasuredLine, measureAdvanceWidth, type TextMeasureOptions } from './textMeasure';

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_LINE_HEIGHT = 1.4;

/**
 * An empty point-text node still needs somewhere to click and a caret to
 * place. This is an editing affordance, not content geometry — it is derived
 * on demand and never serialized as the node's width.
 */
export const EMPTY_TEXT_MIN_WIDTH_EM = 3;

export type TextGeometryMode = 'autoWidth' | 'autoHeight' | 'fixed' | 'path';

export interface TextLineBox extends MeasuredLine {
  /** Offset of this line's box from the top of the layout, in px. */
  y: number;
}

/** Rich-text shape as the scene stores it, narrowed to what layout reads. */
export interface TextGeometryRichRun {
  text: string;
  format?: Partial<TextMeasureOptions>;
}

export interface TextGeometryRichParagraph {
  runs: TextGeometryRichRun[];
}

/**
 * The subset of a text node this module reads. Declared structurally so
 * `@varve/shared` stays free of scene-graph types and every layer above can
 * pass its own node straight in.
 */
export interface TextGeometryInput {
  text: string;
  richText?: { paragraphs: TextGeometryRichParagraph[] } | undefined;
  w?: number | undefined;
  h?: number | undefined;
  fontSize?: number | undefined;
  fontFamily?: string | undefined;
  fontWeight?: number | undefined;
  fontStyle?: 'normal' | 'italic' | undefined;
  letterSpacing?: number | undefined;
  tracking?: number | undefined;
  lineHeight?: number | undefined;
  paragraphSpacing?: number | undefined;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize' | undefined;
  textMode?: 'point' | 'area' | 'auto' | 'path' | string | undefined;
  textResizing?: 'autoWidth' | 'autoHeight' | 'fixed' | undefined;
  variableAxes?: Record<string, number> | undefined;
}

export interface TextGeometry {
  mode: TextGeometryMode;
  /** The user-defined box, when the node has one. Never derived. */
  container: { w: number; h: number } | null;
  /** Union of the line boxes. Always derived; moves with font readiness. */
  layout: { w: number; h: number };
  /** Line boxes in layout order, including empty ones. */
  lines: TextLineBox[];
  /** Selection/transform rectangle for this mode. */
  bounds: { x: number; y: number; w: number; h: number };
}

/**
 * Which resizing contract this node is under.
 *
 * `textResizing` is authoritative when set. Documents predating it — imports
 * especially — express the same intent through `textMode` and the presence of
 * an explicit width: an area box with a width is a container, a width without
 * an area mode is a width constraint (so height follows the wrap), and
 * anything else grows in both directions.
 */
export function resolveTextGeometryMode(node: TextGeometryInput): TextGeometryMode {
  if (node.textMode === 'path') return 'path';
  if (node.textResizing === 'fixed') return 'fixed';
  if (node.textResizing === 'autoHeight') return 'autoHeight';
  if (node.textResizing === 'autoWidth') return 'autoWidth';
  if (node.w !== undefined) return node.textMode === 'area' ? 'fixed' : 'autoHeight';
  return 'autoWidth';
}

function baseOptions(node: TextGeometryInput): TextMeasureOptions {
  return {
    fontSize: node.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: node.fontFamily ?? 'sans-serif',
    fontWeight: node.fontWeight ?? 400,
    fontStyle: node.fontStyle ?? 'normal',
    letterSpacing: node.letterSpacing ?? 0,
    tracking: node.tracking ?? 0,
    lineHeight: node.lineHeight ?? DEFAULT_LINE_HEIGHT,
    textCase: node.textCase ?? 'none',
    ...(node.variableAxes ? { variableAxes: node.variableAxes } : {}),
  };
}

function applyTextCase(text: string, textCase: TextMeasureOptions['textCase']): string {
  switch (textCase) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default:
      return text;
  }
}

/**
 * Source paragraphs in logical order.
 *
 * Rich text is the authority when present: its paragraph array is what the
 * renderer paints, while the flat `text` mirror can lag behind it (a node
 * whose rich text held three paragraphs but whose `text` still read `"One"`
 * was measured as a single line and selected as one).
 */
function sourceParagraphs(node: TextGeometryInput): TextGeometryRichParagraph[] {
  const paragraphs = node.richText?.paragraphs;
  if (paragraphs && paragraphs.length > 0) return paragraphs;
  return node.text.split('\n').map((line) => ({ runs: [{ text: line }] }));
}

/** Per-run options, inheriting anything the run does not override. */
function runOptions(base: TextMeasureOptions, run: TextGeometryRichRun): TextMeasureOptions {
  if (!run.format) return base;
  return { ...base, ...run.format, fontSize: run.format.fontSize ?? base.fontSize };
}

/** One formatted stretch of a paragraph, already text-case transformed. */
interface RunPiece {
  text: string;
  opts: TextMeasureOptions;
  width: number;
}

/** A word or a run of whitespace, possibly spanning several runs. */
interface LineToken {
  pieces: RunPiece[];
  width: number;
  text: string;
  whitespace: boolean;
}

function pieceHeight(opts: TextMeasureOptions): number {
  return (opts.fontSize ?? DEFAULT_FONT_SIZE) * (opts.lineHeight ?? DEFAULT_LINE_HEIGHT);
}

/**
 * The gap the renderer leaves after a glyph, from letter spacing and tracking.
 *
 * `measureAdvanceWidth` already puts this *between* the characters of the
 * string it is handed, so it is only needed at a seam: where a word continues
 * into another run, or where a token is broken into single characters and each
 * measurement would otherwise carry no spacing at all.
 */
function seamSpacing(opts: TextMeasureOptions): number {
  const fontSize = opts.fontSize ?? DEFAULT_FONT_SIZE;
  return (opts.letterSpacing ?? 0) + ((opts.tracking ?? 0) * fontSize) / 1000;
}

function tokenHeight(token: LineToken): number {
  return token.pieces.reduce((tallest, piece) => Math.max(tallest, pieceHeight(piece.opts)), 0);
}

/**
 * Split a paragraph into break opportunities.
 *
 * A word is not the same thing as a run. Formatting changes mid-word all the
 * time (one bold letter, a coloured syllable), so tokens accumulate across run
 * boundaries and only close on whitespace — wrapping at run boundaries instead
 * put the break in the wrong place and reported lines far wider than the box.
 */
function tokenizeParagraph(
  paragraph: TextGeometryRichParagraph,
  base: TextMeasureOptions,
): LineToken[] {
  const tokens: LineToken[] = [];
  let open: LineToken | null = null;

  for (const run of paragraph.runs) {
    if (run.text.length === 0) continue;
    const opts = runOptions(base, run);
    const cased = applyTextCase(run.text, opts.textCase);
    for (const part of cased.split(/(\s+)/)) {
      if (part.length === 0) continue;
      const width = measureAdvanceWidth(part, opts);
      const piece: RunPiece = { text: part, opts, width };
      if (/^\s+$/.test(part)) {
        if (open) {
          tokens.push(open);
          open = null;
        }
        tokens.push({ pieces: [piece], width, text: part, whitespace: true });
        continue;
      }
      if (open) {
        open.pieces.push(piece);
        open.width += width + seamSpacing(opts);
        open.text += part;
      } else {
        open = { pieces: [piece], width, text: part, whitespace: false };
      }
    }
  }
  if (open) tokens.push(open);
  return tokens;
}

/**
 * Break a token that cannot fit on a line of its own, one character at a time.
 *
 * This is the only break opportunity CJK offers — those scripts have no
 * spaces, so without it a Japanese paragraph is a single token, never wraps,
 * and reports a box several times wider than the container the renderer
 * actually breaks it into. It is also what a long unbreakable Latin word needs.
 */
function breakToken(token: LineToken, maxWidth: number, startWidth: number): LineToken[] {
  const parts: LineToken[] = [];
  let current: LineToken | null = null;
  let width = startWidth;
  for (const piece of token.pieces) {
    for (const char of piece.text) {
      const charWidth = measureAdvanceWidth(char, piece.opts);
      const advance = current ? charWidth + seamSpacing(piece.opts) : charWidth;
      if (current && width + advance > maxWidth) {
        parts.push(current);
        current = null;
        width = 0;
      }
      const charPiece: RunPiece = { text: char, opts: piece.opts, width: charWidth };
      if (current) {
        const seam = seamSpacing(piece.opts);
        current.pieces.push(charPiece);
        current.width += charWidth + seam;
        current.text += char;
        width += seam;
      } else {
        current = { pieces: [charPiece], width: charWidth, text: char, whitespace: false };
      }
      width += charWidth;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Lay out one paragraph into line boxes.
 *
 * A paragraph always produces at least one box. An empty paragraph occupies a
 * line in the renderer, the textarea, and the caret model, so dropping it here
 * is what made blank lines vanish from selection height while remaining
 * visible on the canvas.
 *
 * Each line's height comes from the runs actually on *that* line, not from the
 * tallest run anywhere in the paragraph: a wrapped paragraph whose second line
 * is all 12px type does not inherit the leading of a 60px word on the first.
 */
function layoutParagraph(
  paragraph: TextGeometryRichParagraph,
  base: TextMeasureOptions,
  maxWidth: number | null,
): MeasuredLine[] {
  const tokens = tokenizeParagraph(paragraph, base);
  const emptyHeight = pieceHeight(base);
  if (tokens.length === 0) {
    return [{ text: '', width: 0, height: emptyHeight }];
  }

  const lines: MeasuredLine[] = [];
  let lineTokens: LineToken[] = [];
  let lineWidth = 0;

  const flush = (): void => {
    // Trailing whitespace advances the caret but paints no ink, so it must not
    // widen the box that encloses the line.
    while (lineTokens.length > 0 && lineTokens[lineTokens.length - 1]?.whitespace) {
      lineWidth -= lineTokens.pop()?.width ?? 0;
    }
    const height = lineTokens.reduce((tallest, token) => Math.max(tallest, tokenHeight(token)), 0);
    lines.push({
      text: lineTokens.map((token) => token.text).join(''),
      width: Math.max(0, lineWidth),
      height: height || emptyHeight,
    });
    lineTokens = [];
    lineWidth = 0;
  };

  for (const token of tokens) {
    if (maxWidth === null) {
      lineTokens.push(token);
      lineWidth += token.width;
      continue;
    }
    if (token.whitespace) {
      // A break already happened here; leading whitespace on the new line is
      // dropped rather than indenting it.
      if (lineTokens.length === 0) continue;
      lineTokens.push(token);
      lineWidth += token.width;
      continue;
    }
    if (lineWidth + token.width <= maxWidth) {
      lineTokens.push(token);
      lineWidth += token.width;
      continue;
    }
    if (token.width <= maxWidth) {
      flush();
      lineTokens.push(token);
      lineWidth = token.width;
      continue;
    }
    // Too wide even alone: break it by character, continuing the current line.
    const fragments = breakToken(token, maxWidth, lineWidth);
    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i];
      if (!fragment) continue;
      if (i > 0) flush();
      lineTokens.push(fragment);
      lineWidth += fragment.width;
    }
  }
  flush();
  return lines;
}

/**
 * Resolve the container, layout, and selection rectangles for a text node.
 *
 * Pure and synchronous. The numbers change when the document changes and when
 * the usable font set changes (through the advance backend registered on
 * `textMeasure`) — never on their own, so callers may memoize against
 * `textMeasureRevision()`.
 */
export function resolveTextGeometry(node: TextGeometryInput): TextGeometry {
  const mode = resolveTextGeometryMode(node);
  const base = baseOptions(node);
  const fontSize = base.fontSize ?? DEFAULT_FONT_SIZE;
  const paragraphSpacing = node.paragraphSpacing ?? 0;

  // Only a width *constraint* wraps. `autoWidth` never wraps, so a stale `w`
  // on such a node must not silently start folding its lines.
  const constraintWidth =
    mode === 'autoHeight' || mode === 'fixed' ? Math.max(0, node.w ?? 0) || null : null;

  const paragraphs = sourceParagraphs(node);
  const lines: TextLineBox[] = [];
  let layoutWidth = 0;
  let y = 0;
  for (let p = 0; p < paragraphs.length; p++) {
    if (p > 0) y += paragraphSpacing;
    for (const line of layoutParagraph(paragraphs[p]!, base, constraintWidth)) {
      lines.push({ ...line, y });
      layoutWidth = Math.max(layoutWidth, line.width);
      y += line.height;
    }
  }
  const layoutHeight = y;

  const container =
    node.w !== undefined || node.h !== undefined
      ? { w: node.w ?? layoutWidth, h: node.h ?? layoutHeight }
      : null;

  // The affordance floor exists so an *empty* node can be clicked and given a
  // caret. Applying it to text that has content would hand a one-letter node a
  // box several times wider than its ink, so the selection rectangle would
  // stop describing the text it encloses.
  const emptyMinWidth = layoutWidth > 0 ? 0 : fontSize * EMPTY_TEXT_MIN_WIDTH_EM;
  const layout = { w: layoutWidth, h: layoutHeight };

  let bounds: { x: number; y: number; w: number; h: number };
  switch (mode) {
    case 'fixed':
      bounds = {
        x: 0,
        y: 0,
        w: node.w ?? Math.max(layoutWidth, emptyMinWidth),
        h: node.h ?? Math.max(layoutHeight, fontSize * (base.lineHeight ?? DEFAULT_LINE_HEIGHT)),
      };
      break;
    case 'autoHeight':
      bounds = {
        x: 0,
        y: 0,
        w: node.w ?? Math.max(layoutWidth, emptyMinWidth),
        h: Math.max(layoutHeight, fontSize * (base.lineHeight ?? DEFAULT_LINE_HEIGHT)),
      };
      break;
    // Path text's rectangle comes from the path, not from a text box; the
    // editor unions this with the path's own world bounds. Any explicit box
    // is kept so an on-path node stays where its document said it was.
    case 'path':
      bounds = {
        x: 0,
        y: 0,
        w: node.w ?? Math.max(layoutWidth, emptyMinWidth),
        h: node.h ?? Math.max(layoutHeight, fontSize * (base.lineHeight ?? DEFAULT_LINE_HEIGHT)),
      };
      break;
    // autoWidth: both dimensions follow the content, and any `w`/`h` the node
    // carries is a stale measurement from an earlier state, not a container.
    default:
      bounds = {
        x: 0,
        y: 0,
        w: Math.max(layoutWidth, emptyMinWidth),
        h: Math.max(layoutHeight, fontSize * (base.lineHeight ?? DEFAULT_LINE_HEIGHT)),
      };
      break;
  }

  return { mode, container, layout, lines, bounds };
}
