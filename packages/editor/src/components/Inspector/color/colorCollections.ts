/**
 * colorCollections — helpers for extracting document colors and managing
 * recent-colors session storage for the ColorPicker swatch palette.
 */

import type { Document, ManagedColor, SceneNode } from '@varve/scene';
import { resolveNodeFills } from '@varve/scene';
import { managedColorKey, managedColorToRgba } from '@varve/shared';

const MAX_DOC_COLORS = 32;
const MAX_RECENT_COLORS = 16;
const RECENT_KEY = 'strata:recent-colors';

function colorKey(c: ManagedColor): string {
  // Canonical identity key — two colors that differ below 8-bit resolution
  // (e.g. adjacent uint16 values) must not collapse into one swatch.
  return managedColorKey(c);
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
    // All authorable spaces are kept (including Lab/LCH — they are valid
    // canonical values and the picker handles them natively). Registration
    // and unresolved values are excluded: registration prints on every
    // plate, and unresolved colors have no authoritative interpretation.
    return parsed.filter(
      (c): c is ManagedColor =>
        typeof c === 'object' &&
        c !== null &&
        !Array.isArray(c) &&
        'space' in c &&
        (c.space === 'rgb' ||
          c.space === 'cmyk' ||
          c.space === 'gray' ||
          c.space === 'spot' ||
          c.space === 'lab' ||
          c.space === 'lch'),
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
