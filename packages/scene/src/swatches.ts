import { managedColorToRgba } from '@varve/shared';
import type { ColorSwatch, ManagedColor, RgbColor } from './colorManagement';
import type { Document } from './document';

function swatchId(): string {
  return `sw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

export function addSwatch(doc: Document, name: string, color: ManagedColor): Document {
  const swatch: ColorSwatch = { id: swatchId(), name, color };
  return { ...doc, swatches: [...(doc.swatches ?? []), swatch] };
}

export function removeSwatch(doc: Document, swatchId: string): Document {
  if (!doc.swatches || doc.swatches.length === 0) return doc;
  const idx = doc.swatches.findIndex((s) => s.id === swatchId);
  if (idx < 0) return doc;
  const next = [...doc.swatches];
  next.splice(idx, 1);
  return { ...doc, swatches: next };
}

export function updateSwatch(doc: Document, swatchId: string, color: ManagedColor): Document {
  if (!doc.swatches || doc.swatches.length === 0) return doc;
  const idx = doc.swatches.findIndex((s) => s.id === swatchId);
  if (idx < 0) return doc;
  const next = doc.swatches.map((s) => (s.id === swatchId ? { ...s, color } : s));
  return { ...doc, swatches: next };
}

export function renameSwatch(doc: Document, swatchId: string, name: string): Document {
  if (!doc.swatches || doc.swatches.length === 0) return doc;
  const idx = doc.swatches.findIndex((s) => s.id === swatchId);
  if (idx < 0) return doc;
  const next = doc.swatches.map((s) => (s.id === swatchId ? { ...s, name } : s));
  return { ...doc, swatches: next };
}

export function applySwatchToNode(doc: Document, nodeId: string, swatchId: string): Document {
  if (!doc.swatches || doc.swatches.length === 0) return doc;
  const swatch = doc.swatches.find((s) => s.id === swatchId);
  if (!swatch) return doc;
  const node = doc.nodes[nodeId];
  if (!node) return doc;
  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: { ...node, fill: swatch.color } },
  };
}

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

export function addSwatches(
  doc: Document,
  entries: Array<{ name: string; color: ManagedColor }>,
): Document {
  const newSwatches = entries.map(
    (e): ColorSwatch => ({ id: swatchId(), name: e.name, color: e.color }),
  );
  return { ...doc, swatches: [...(doc.swatches ?? []), ...newSwatches] };
}

export function removeSwatches(doc: Document, swatchIds: string[]): Document {
  if (!doc.swatches || doc.swatches.length === 0) return doc;
  const idSet = new Set(swatchIds);
  const next = doc.swatches.filter((s) => !idSet.has(s.id));
  if (next.length === doc.swatches.length) return doc;
  return { ...doc, swatches: next };
}

export function reorderSwatches(doc: Document, fromIndex: number, toIndex: number): Document {
  if (!doc.swatches || doc.swatches.length === 0) return doc;
  if (fromIndex < 0 || fromIndex >= doc.swatches.length) return doc;
  if (toIndex < 0 || toIndex >= doc.swatches.length) return doc;
  const next = [...doc.swatches];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return { ...doc, swatches: next };
}

// ---------------------------------------------------------------------------
// Color conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert a ManagedColor to a hex string (#rrggbb).
 * RGB passes through; every other space is reduced via the canonical
 * display reduction (managedColorToRgba), so Lab/LCH/spot/registration/
 * unresolved colors produce the same preview values as the renderer.
 */
export function managedColorToHex(color: ManagedColor): string {
  if (color.space === 'rgb') {
    const r = Math.round(color.r);
    const g = Math.round(color.g);
    const b = Math.round(color.b);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  const [r, g, b] = managedColorToRgba(color);
  return `#${Math.max(0, Math.min(255, r)).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, g)).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, b)).toString(16).padStart(2, '0')}`;
}

/**
 * Parse a hex color string into an RGB ManagedColor.
 */
export function hexToManagedColor(hex: string): RgbColor {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return { space: 'rgb', r, g, b, a: 255 };
}

// ---------------------------------------------------------------------------
// Palette extraction from swatches
// ---------------------------------------------------------------------------

/**
 * Extract a palette (array of hex strings) from document swatches.
 * Useful for feeding into palette-colorize workflows.
 */
export function swatchesToPalette(swatches: ColorSwatch[]): string[] {
  return swatches.map((s) => managedColorToHex(s.color));
}

/**
 * Create swatches from an extracted palette (array of hex strings).
 * Returns a new Document with the palette added as named swatches.
 */
export function paletteToSwatches(doc: Document, palette: string[], prefix = 'Palette'): Document {
  const entries = palette.map((hex, i) => ({
    name: `${prefix} ${i + 1}`,
    color: hexToManagedColor(hex),
  }));
  return addSwatches(doc, entries);
}

// ---------------------------------------------------------------------------
// Swatch queries
// ---------------------------------------------------------------------------

export function getSwatchById(doc: Document, swatchId: string): ColorSwatch | undefined {
  return doc.swatches?.find((s) => s.id === swatchId);
}

export function getSwatchByColor(doc: Document, color: ManagedColor): ColorSwatch | undefined {
  if (!doc.swatches) return undefined;
  const hex = managedColorToHex(color);
  return doc.swatches.find((s) => managedColorToHex(s.color) === hex);
}

export function findSwatchesByName(doc: Document, query: string): ColorSwatch[] {
  if (!doc.swatches) return [];
  const lower = query.toLowerCase();
  return doc.swatches.filter((s) => s.name.toLowerCase().includes(lower));
}

/**
 * Get the palette revision — a monotonically increasing number
 * bumped on every swatch mutation. Used for stale-result detection
 * in the colorization pipeline.
 */
export function getSwatchRevision(doc: Document): number {
  return doc.swatches?.length ?? 0;
}
