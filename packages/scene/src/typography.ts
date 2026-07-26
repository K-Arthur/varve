/**
 * Typography subsystem types — rich text runs, character/paragraph styles,
 * variable font axes, OpenType features, and text flow chains.
 *
 * Research basis: Figma text properties, Adobe InDesign threading/styles,
 * OpenType variation axis registry, HarfBuzz variable font API.
 */

import type { Document } from './document';
import type {
  AdaptiveContrastPolicy,
  AdaptiveContrastState,
  CharacterFormat,
  NodeId,
  OpenTypeFeatureMap,
  OpenTypeFeatureTag,
  Paragraph,
  ParagraphFormat,
  PathTextSettings,
  RegisteredAxisTag,
  RichText,
  TabStop,
  TabStopAlignment,
  TextMode,
  TextRun,
  VariableFontAxis,
  VariableFontInstance,
  VariableFontSettings,
} from './types';

export type {
  AdaptiveContrastPolicy,
  AdaptiveContrastState,
  CharacterFormat,
  OpenTypeFeatureMap,
  OpenTypeFeatureTag,
  Paragraph,
  ParagraphFormat,
  PathTextSettings,
  RegisteredAxisTag,
  RichText,
  TabStop,
  TabStopAlignment,
  TextMode,
  TextRun,
  VariableFontAxis,
  VariableFontInstance,
  VariableFontSettings,
};

export const OPEN_TYPE_PRESETS: Record<string, OpenTypeFeatureMap> = {
  default: { liga: true, kern: true, calt: true },
  editorial: { liga: true, kern: true, calt: true, onum: true, pnum: true },
  tabular: { liga: true, kern: true, tnum: true, lnum: true },
  display: { liga: true, dlig: true, kern: true, calt: true },
  code: { liga: false, kern: true, tnum: true, zero: true },
};

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
  if (node?.kind !== 'text') return doc;

  const existing = (node as import('./types').TextNode).adaptiveContrast;
  if (ac.enabled === false) {
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

export function resolveTextColor(node: import('./types').TextNode): import('./types').ManagedColor {
  const ac = node.adaptiveContrast;
  if (ac?.enabled && ac.resolvedColor) {
    return ac.resolvedColor;
  }
  return node.fill;
}

export function resolveTextColorWithOverride(
  node: import('./types').TextNode,
  overrideColor?: import('./types').ManagedColor,
): import('./types').ManagedColor {
  if (overrideColor) return overrideColor;
  return resolveTextColor(node);
}

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
