/**
 * colorCollections — helpers for extracting document colors and managing
 * recent-colors session storage for the ColorPicker swatch palette.
 */
import type { Color } from '@strata/engine';
import type { Document, SceneNode } from '@strata/scene';
import { resolveNodeFills } from '@strata/scene';

const MAX_DOC_COLORS = 32;
const MAX_RECENT_COLORS = 16;
const RECENT_KEY = 'strata:recent-colors';

function colorKey(c: Color): string {
  return `${c[0]},${c[1]},${c[2]},${c[3]}`;
}

export function extractDocumentColors(doc: Document): Color[] {
  const seen = new Set<string>();
  const out: Color[] = [];
  const nodes = Object.values(doc.nodes) as SceneNode[];
  for (const node of nodes) {
    const fills = resolveNodeFills(node);
    for (const fill of fills) {
      if (fill.type === 'solid' && fill.color) {
        const k = colorKey(fill.color);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(fill.color);
          if (out.length >= MAX_DOC_COLORS) return out;
        }
      }
    }
    const strokes = 'strokes' in node ? (node.strokes ?? []) : [];
    for (const stroke of strokes) {
      const k = colorKey(stroke.color);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(stroke.color);
        if (out.length >= MAX_DOC_COLORS) return out;
      }
    }
  }
  return out;
}

export function getRecentColors(): Color[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Color[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c) => Array.isArray(c) && c.length === 4 && c.every((n) => typeof n === 'number'),
    );
  } catch {
    return [];
  }
}

export function addRecentColor(color: Color): Color[] {
  const current = getRecentColors();
  const k = colorKey(color);
  const filtered = current.filter((c) => colorKey(c) !== k);
  const next = [color, ...filtered].slice(0, MAX_RECENT_COLORS);
  try {
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage unavailable
  }
  return next;
}
