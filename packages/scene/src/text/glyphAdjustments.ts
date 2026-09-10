/**
 * Glyph-level typography document ops — pure, undoable via the editor's
 * updateDoc, shared by every surface (Logo panel, Inspector).
 *
 * Cluster indices are UAX #29 grapheme indices into the node's text.
 * Constraints (canGlyphAdjust) mirror the renderer's cluster-safe path:
 * plain text only, single line, LTR, no case transform, no list style,
 * not path text. Outside those, glyph editing is disabled with a reason
 * rather than corrupting shaping.
 */

import type { Document } from '../document';
import type { GlyphAdjustment, KerningMode, NodeId, TextNode } from '../types';

export const EMPTY_GLYPH_ADJUSTMENT: GlyphAdjustment = {
  dx: 0,
  dy: 0,
  advance: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

function textNodeOf(doc: Document, nodeId: NodeId): TextNode | null {
  const node = doc.nodes[nodeId];
  return node && node.kind === 'text' ? node : null;
}

function patchText(doc: Document, nodeId: NodeId, patch: Partial<TextNode>): Document {
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: { ...(doc.nodes[nodeId] as TextNode), ...patch } },
  };
}

/** Whether glyph-level editing is safe for this text node (with a reason). */
export function canGlyphAdjust(node: TextNode | undefined): { ok: boolean; reason?: string } {
  if (!node) return { ok: false, reason: 'Select a text layer first' };
  if (node.richText)
    return { ok: false, reason: 'Glyph editing requires plain text (no rich text spans)' };
  const text = node.text ?? '';
  if (text.length === 0) return { ok: false, reason: 'The text is empty' };
  if (text.includes('\n')) return { ok: false, reason: 'Glyph editing works on single-line text' };
  if (node.direction === 'rtl')
    return { ok: false, reason: 'Glyph editing is not supported for RTL text yet' };
  if (node.textCase && node.textCase !== 'none')
    return { ok: false, reason: 'Glyph editing is not supported with text case transforms' };
  if (node.listStyle && node.listStyle !== 'none')
    return { ok: false, reason: 'Glyph editing is not supported with list styles' };
  if (node.textMode === 'path')
    return { ok: false, reason: 'Glyph editing is not supported for path text' };
  return { ok: true };
}

export function setTextKerningMode(doc: Document, nodeId: NodeId, mode: KerningMode): Document {
  const node = textNodeOf(doc, nodeId);
  if (!node) return doc;
  return patchText(doc, nodeId, { kerningMode: mode === 'none' ? 'none' : 'auto' });
}

/** Set or clear (null) the adjustment for one cluster. */
export function setGlyphAdjustment(
  doc: Document,
  nodeId: NodeId,
  clusterIndex: number,
  adjustment: Partial<GlyphAdjustment> | null,
): Document {
  const node = textNodeOf(doc, nodeId);
  if (!node || !canGlyphAdjust(node).ok) return doc;
  if (adjustment === null) {
    const current = node.glyphAdjustments ? { ...node.glyphAdjustments } : {};
    delete current[clusterIndex];
    return patchText(doc, nodeId, { glyphAdjustments: current });
  }
  const previous = node.glyphAdjustments?.[clusterIndex] ?? EMPTY_GLYPH_ADJUSTMENT;
  const next = { ...(node.glyphAdjustments ?? {}) };
  next[clusterIndex] = { ...previous, ...adjustment };
  return patchText(doc, nodeId, { glyphAdjustments: next });
}

/** Set or clear (null) the pair spacing between cluster i and i+1. */
export function setPairAdjustment(
  doc: Document,
  nodeId: NodeId,
  clusterIndex: number,
  px: number | null,
): Document {
  const node = textNodeOf(doc, nodeId);
  if (!node || !canGlyphAdjust(node).ok) return doc;
  const current = node.pairAdjustments ? { ...node.pairAdjustments } : {};
  if (px === null || px === 0) {
    delete current[clusterIndex];
  } else {
    current[clusterIndex] = px;
  }
  return patchText(doc, nodeId, { pairAdjustments: current });
}

export function clearGlyphAdjustments(doc: Document, nodeId: NodeId): Document {
  const node = textNodeOf(doc, nodeId);
  if (!node) return doc;
  if (node.glyphAdjustments && Object.keys(node.glyphAdjustments).length > 0) {
    doc = patchText(doc, nodeId, { glyphAdjustments: undefined });
  }
  if (node.pairAdjustments && Object.keys(node.pairAdjustments).length > 0) {
    doc = patchText(doc, nodeId, { pairAdjustments: undefined });
  }
  return doc;
}

/** Number of adjusted clusters / pairs for status display. */
export function glyphAdjustmentStats(node: TextNode | undefined): {
  adjustedClusters: number;
  adjustedPairs: number;
} {
  if (!node) return { adjustedClusters: 0, adjustedPairs: 0 };
  return {
    adjustedClusters: node.glyphAdjustments ? Object.keys(node.glyphAdjustments).length : 0,
    adjustedPairs: node.pairAdjustments ? Object.keys(node.pairAdjustments).length : 0,
  };
}
