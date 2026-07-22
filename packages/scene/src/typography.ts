/**
 * Typography subsystem types — rich text runs, character/paragraph styles,
 * variable font axes, OpenType features, and text flow chains.
 *
 * Research basis: Figma text properties, Adobe InDesign threading/styles,
 * OpenType variation axis registry, HarfBuzz variable font API.
 */

import type { Document } from './document';
import type { NodeId } from './types';

// ── OpenType Features ───────────────────────────────────────────────────────

export type OpenTypeFeatureTag =
  | 'liga'
  | 'dlig'
  | 'sups'
  | 'subs'
  | 'numr'
  | 'dnom'
  | 'frac'
  | 'ordn'
  | 'tnum'
  | 'pnum'
  | 'lnum'
  | 'onum'
  | 'zero'
  | 'ss01'
  | 'ss02'
  | 'ss03'
  | 'ss04'
  | 'ss05'
  | 'ss06'
  | 'ss07'
  | 'ss08'
  | 'ss09'
  | 'ss10'
  | 'ss11'
  | 'ss12'
  | 'ss13'
  | 'ss14'
  | 'ss15'
  | 'ss16'
  | 'ss17'
  | 'ss18'
  | 'ss19'
  | 'ss20'
  | 'cv01'
  | 'cv02'
  | 'cv03'
  | 'cv04'
  | 'cv05'
  | 'cv06'
  | 'cv07'
  | 'cv08'
  | 'cv09'
  | 'cv10'
  | 'cv11'
  | 'cv12'
  | 'cv13'
  | 'cv14'
  | 'cv15'
  | 'kern'
  | 'cpsp'
  | 'case'
  | 'aalt'
  | 'salt'
  | 'nalt'
  | 'calt'
  | 'rclt'
  | 'rvrn'
  | 'locl'
  | 'rlig'
  | 'curs'
  | 'mark'
  | 'mkmk'
  | 'dist'
  | 'abvm'
  | 'blwm'
  | 'ccmp'
  | 'init'
  | 'medi'
  | 'fina'
  | 'isol';

export type OpenTypeFeatureMap = Partial<Record<OpenTypeFeatureTag, boolean>> & {
  custom?: Record<string, boolean>;
};

export const OPEN_TYPE_PRESETS: Record<string, OpenTypeFeatureMap> = {
  default: { liga: true, kern: true, calt: true },
  editorial: { liga: true, kern: true, calt: true, onum: true, pnum: true },
  tabular: { liga: true, kern: true, tnum: true, lnum: true },
  display: { liga: true, dlig: true, kern: true, calt: true },
  code: { liga: false, kern: true, tnum: true, zero: true },
};

// ── Variable Font Axes ──────────────────────────────────────────────────────

export type RegisteredAxisTag = 'wght' | 'wdth' | 'slnt' | 'opsz' | 'ital';

export interface VariableFontAxis {
  tag: string;
  name: string;
  min: number;
  default: number;
  max: number;
  precision?: number;
  isRegistered: boolean;
}

export interface VariableFontInstance {
  name: string;
  coordinates: Record<string, number>;
}

export type VariableFontSettings = Record<string, number>;

// ── Character Formatting ────────────────────────────────────────────────────

export interface CharacterFormat {
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  color?: readonly [number, number, number, number];
  openTypeFeatures?: OpenTypeFeatureMap;
  variableFontSettings?: VariableFontSettings;
  fontVariant?: 'normal' | 'small-caps' | 'all-small-caps';
  baselineShift?: number;
  superscript?: boolean;
  subscript?: boolean;
  kerning?: 'auto' | 'manual' | 'none';
  tracking?: number;
  language?: string;
}

// ── Tab Stops ────────────────────────────────────────────────────────────────

export type TabStopAlignment = 'left' | 'center' | 'right' | 'decimal';

export interface TabStop {
  position: number;
  alignment: TabStopAlignment;
  alignmentChar?: string;
  leader?: string;
}

// ── Paragraph Formatting ────────────────────────────────────────────────────

export interface ParagraphFormat {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  firstLineIndent?: number;
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  listIndent?: number;
  hangingIndent?: boolean;
  hangingQuotes?: boolean;
  hangingLists?: boolean;
  maxLines?: number;
  textOverflow?: 'clip' | 'ellipsis' | 'visible';
  hyphenation?: boolean;
  keepWithNext?: boolean;
  keepTogether?: boolean;
  widowControl?: boolean;
  orphanControl?: boolean;
  dropCapLines?: number;
  dropCapChars?: number;
  direction?: 'ltr' | 'rtl';
  writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
  columnCount?: number;
  columnGap?: number;
  columnRuleWidth?: number;
  columnRuleColor?: readonly [number, number, number, number];
  tabStops?: TabStop[];
  tabSize?: number;
}

// ── Rich Text Runs ──────────────────────────────────────────────────────────

export interface TextRun {
  text: string;
  format?: CharacterFormat;
  characterStyleId?: NodeId;
}

export interface Paragraph {
  runs: TextRun[];
  format?: ParagraphFormat;
  paragraphStyleId?: NodeId;
}

export interface RichText {
  paragraphs: Paragraph[];
}

// ── Character & Paragraph Styles ────────────────────────────────────────────

export interface CharacterStyle {
  id: NodeId;
  type: 'character';
  name: string;
  format: CharacterFormat;
  parentId?: NodeId;
  description?: string;
}

export interface ParagraphStyle {
  id: NodeId;
  type: 'paragraph';
  name: string;
  format: ParagraphFormat;
  characterFormat?: CharacterFormat;
  parentId?: NodeId;
  basedOn?: NodeId;
  nextStyleId?: NodeId;
  description?: string;
}

export type TypographyStyle = CharacterStyle | ParagraphStyle;

// ── Text Flow Chains ────────────────────────────────────────────────────────

export interface TextChain {
  id: string;
  name: string;
  frameIds: NodeId[];
  richText?: RichText;
}

export interface OversetInfo {
  chainId: string;
  frameId: NodeId;
  oversetChars: number;
  isLastFrame: boolean;
}

// ── Text Node Type ──────────────────────────────────────────────────────────

export type TextMode = 'point' | 'area' | 'path' | 'auto';

export interface PathTextSettings {
  pathNodeId: NodeId;
  startOffset?: number;
  endOffset?: number;
  side?: 'top' | 'bottom';
  flip?: boolean;
  baselineShift?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function plainTextToRichText(text: string): RichText {
  const lines = text.split('\n');
  return {
    paragraphs: lines.map((line) => ({ runs: [{ text: line }] })),
  };
}

export function richTextToPlainText(rich: RichText): string {
  return rich.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}

export function mergeCharacterFormat(
  base: CharacterFormat,
  override: CharacterFormat,
): CharacterFormat {
  const result: CharacterFormat = { ...base };
  for (const key of Object.keys(override) as (keyof CharacterFormat)[]) {
    const val = override[key];
    if (val !== undefined && val !== null) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

export function mergeParagraphFormat(
  base: ParagraphFormat,
  override: ParagraphFormat,
): ParagraphFormat {
  const result: ParagraphFormat = { ...base };
  for (const key of Object.keys(override) as (keyof ParagraphFormat)[]) {
    const val = override[key];
    if (val !== undefined && val !== null) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

const STYLE_CHAIN_MAX_DEPTH = 50;

/**
 * Resolve a style chain by following `parentId`/`basedOn` references.
 * Returns the ordered chain from root (most ancestral) to leaf (the requested style).
 * Detects cycles by tracking visited IDs.
 */
/**
 * Result of walking a style chain. `chain` is the ordered list of styles
 * (root → leaf). When `cyclical` is true, the chain should be discarded.
 */
interface ChainResult<T> {
  chain: T[];
  cyclical: boolean;
}

export function resolveStyleChain<T extends { id: NodeId; parentId?: NodeId }>(
  styleId: NodeId,
  styles: Record<NodeId, T>,
  depth = 0,
  visited = new Set<NodeId>(),
): T[] {
  const result = resolveStyleChainInternal(styleId, styles, depth, visited);
  return result.cyclical ? [] : result.chain;
}

function resolveStyleChainInternal<T extends { id: NodeId; parentId?: NodeId }>(
  styleId: NodeId,
  styles: Record<NodeId, T>,
  depth = 0,
  visited = new Set<NodeId>(),
): ChainResult<T> {
  if (depth > STYLE_CHAIN_MAX_DEPTH) return { chain: [], cyclical: false };
  if (visited.has(styleId)) return { chain: [], cyclical: true };
  visited.add(styleId);
  const style = styles[styleId];
  if (!style) return { chain: [], cyclical: false };
  if (style.parentId) {
    const parentResult = resolveStyleChainInternal(style.parentId, styles, depth + 1, visited);
    if (parentResult.cyclical) return { chain: [], cyclical: true };
    return { chain: [...parentResult.chain, style], cyclical: false };
  }
  return { chain: [style], cyclical: false };
}

/**
 * Resolve a character format by walking the style inheritance chain.
 * Merges from the most ancestral style through intermediates to local overrides.
 */
export function resolveCharacterFormat(
  run: TextRun,
  characterStyles: Record<NodeId, CharacterStyle>,
  paragraphDefault?: CharacterFormat,
): CharacterFormat {
  let resolved: CharacterFormat = paragraphDefault ?? {};
  if (run.characterStyleId) {
    const chain = resolveStyleChain(run.characterStyleId, characterStyles);
    for (const link of chain) {
      resolved = mergeCharacterFormat(resolved, link.format);
    }
  }
  if (run.format) resolved = mergeCharacterFormat(resolved, run.format);
  return resolved;
}

// ── Adaptive Contrast State ─────────────────────────────────────────────────

export type AdaptiveContrastPolicy = 'wcag-aa' | 'wcag-aaa' | 'custom';

/**
 * Persistent adaptive contrast state stored on a TextNode.
 * The `resolvedColor` is computed at render time by the adaptive contrast
 * engine; the stored `fill` on the TextNode remains the author's original
 * choice so switching adaptive contrast on/off is non-destructive.
 */
export interface AdaptiveContrastState {
  enabled: boolean;
  policy: AdaptiveContrastPolicy;
  /** Light candidate color shown on dark backdrops. */
  lightColor?: import('./types').ManagedColor;
  /** Dark candidate color shown on light backdrops. */
  darkColor?: import('./types').ManagedColor;
  /** Custom target ratio when policy is 'custom' (4.5 - 21). */
  customRatio?: number;
  /** Hysteresis threshold to prevent flickering (0-1, default 0.5). */
  hysteresis?: number;
  /** Last keyboard focus/active visible start time for re-evaluation. */
  lastResolved?: number;
  /**
   * The resolved text colour from the last adaptive contrast evaluation.
   * This overrides the stored fill during rendering and export.
   * Reset to undefined when adaptive contrast is disabled.
   */
  resolvedColor?: import('./types').ManagedColor;
}

/**
 * Set or update adaptive contrast state on a text node.
 * Returns a new document with the updated node.
 */
export function setTextAdaptiveContrast(
  doc: Document,
  nodeId: string,
  ac: Partial<AdaptiveContrastState>,
): Document {
  const node = doc.nodes[nodeId];
  if (!node || node.kind !== 'text') return doc;

  const existing = (node as import('./types').TextNode).adaptiveContrast;
  if (ac.enabled === false) {
    // Disabling: clear resolvedColor so rendering falls back to stored fill
    const updatedNode = {
      ...node,
      adaptiveContrast: {
        ...existing,
        ...ac,
        enabled: false,
        resolvedColor: undefined,
      } as AdaptiveContrastState,
    };
    return {
      ...doc,
      nodes: { ...doc.nodes, [nodeId]: updatedNode as import('./types').SceneNode },
    };
  }

  const updatedNode = {
    ...node,
    adaptiveContrast: { ...existing, ...ac } as AdaptiveContrastState,
  };
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: updatedNode as import('./types').SceneNode } };
}

/**
 * Resolve the effective text colour for a text node, accounting for adaptive
 * contrast. Returns the resolved colour if adaptive contrast is enabled and a
 * `resolvedColor` exists, otherwise returns the node's stored fill.
 */
export function resolveTextColor(node: import('./types').TextNode): import('./types').ManagedColor {
  const ac = node.adaptiveContrast;
  if (ac?.enabled && ac.resolvedColor) {
    return ac.resolvedColor;
  }
  return node.fill;
}

/**
 * Resolve the effective text colour for a text node, given an explicit
 * resolved colour override. Used by the render pipeline to temporarily
 * override the stored fill without mutating the document.
 */
export function resolveTextColorWithOverride(
  node: import('./types').TextNode,
  overrideColor?: import('./types').ManagedColor,
): import('./types').ManagedColor {
  if (overrideColor) return overrideColor;
  return resolveTextColor(node);
}

/**
 * Resolve a paragraph format by walking the style inheritance chain.
 * Merges from the most ancestral style through intermediates, then applies
 * character-level format overrides from the paragraph style's characterFormat,
 * then local overrides.
 */
export function resolveParagraphFormat(
  para: Paragraph,
  paragraphStyles: Record<NodeId, ParagraphStyle>,
  documentDefault?: ParagraphFormat,
): ParagraphFormat {
  let resolved: ParagraphFormat = documentDefault ?? {};
  if (para.paragraphStyleId) {
    const chain = resolveStyleChain(para.paragraphStyleId, paragraphStyles);
    for (const link of chain) {
      resolved = mergeParagraphFormat(resolved, link.format);
      if (link.characterFormat) {
        // Apply paragraph style's character-level overrides
        resolved = mergeParagraphFormat(
          resolved,
          link.characterFormat as unknown as ParagraphFormat,
        );
      }
    }
  }
  if (para.format) resolved = mergeParagraphFormat(resolved, para.format);
  return resolved;
}
