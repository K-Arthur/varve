import type { ManagedColor, ColorSwatch } from './colorManagement';
import type { Document } from './document';

function swatchId(): string {
  return `sw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
