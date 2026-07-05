/**
 * colorCollections — helpers for extracting document colors and managing
 * recent-colors session storage for the ColorPicker swatch palette.
 */

import type { Document, ManagedColor, SceneNode } from '@strata/scene';
import { resolveNodeFills } from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';

const MAX_DOC_COLORS = 32;
const MAX_RECENT_COLORS = 16;
const RECENT_KEY = 'strata:recent-colors';

function colorKey(c: ManagedColor): string {
  const [r, g, b, a] = managedColorToRgba(c);
  return `${r},${g},${b},${a}`;
}

export function extractDocumentColors(doc: Document): ManagedColor[] {
  const seen = new Set<string>();
  const out: ManagedColor[] = [];
  const nodes = Object.values(doc.nodes) as SceneNode[];
  for (const node of nodes) {
    const fills = resolveNodeFills(node);
    for (const fill of fills) {
      if (fill.type === 'solid' && fill.color) {
        const [, , , a] = managedColorToRgba(fill.color);
        if (a === 0) continue;
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
      const [, , , a] = managedColorToRgba(stroke.color);
      if (a === 0) continue;
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

export function getRecentColors(): ManagedColor[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ManagedColor[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is ManagedColor =>
        typeof c === 'object' &&
        c !== null &&
        !Array.isArray(c) &&
        'space' in c &&
        (c.space === 'rgb' || c.space === 'cmyk' || c.space === 'gray' || c.space === 'spot'),
    );
  } catch {
    return [];
  }
}

export function addRecentColor(color: ManagedColor): ManagedColor[] {
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
