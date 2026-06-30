/**
 * Auto-naming — per-type incrementing counter ("Rectangle 1", "Frame 2").
 *
 * Scans existing node names for the highest counter per type and generates
 * the next unique name.
 */
import type { Document, SceneNode } from '@strata/scene';

const TYPE_LABELS: Record<string, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  circle: 'Circle',
  line: 'Line',
  polygon: 'Polygon',
  star: 'Star',
  frame: 'Frame',
  group: 'Group',
  text: 'Text',
  pen: 'Path',
  image: 'Image',
  component: 'Component',
};

export function typeLabel(node: SceneNode): string {
  if (node.kind === 'shape') return TYPE_LABELS[node.shape.kind] ?? 'Shape';
  return TYPE_LABELS[node.kind] ?? node.kind;
}

export function nextNameForType(doc: Document, typeName: string): string {
  const used = new Set<number>();
  for (const n of Object.values(doc.nodes)) {
    const match = n.name.match(new RegExp(`^${typeName} (\\d+)$`));
    if (match?.[1]) used.add(Number.parseInt(match[1], 10));
  }
  let i = 1;
  while (used.has(i)) i++;
  return `${typeName} ${i}`;
}
