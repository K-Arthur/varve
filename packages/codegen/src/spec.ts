/**
 * Local spec inspector — developer-facing design-specification view.
 *
 * `buildSpec()` walks a Document and extracts spacing tokens, type styles,
 * layout details, and asset info into a structured `SpecSheet` suitable for
 * display in a panel or copy-to-clipboard handoff.
 *
 * Research basis: Figma Dev Mode / Inspect panel — shows resolved values for
 * spacing, typography, and fills without server round-trip.
 */
import { managedColorToRgba } from '@strata/shared';
import type { Document, NodeId, SceneNode, ManagedColor } from '@strata/scene';

/** A resolved spacing token with its value and usage count. */
export interface SpecSpacing {
  name: string;
  value: number;
  /** How many times this spacing value is used across the document. */
  count: number;
}

/** A resolved type style. */
export interface SpecTypeStyle {
  id: string;
  name: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: number;
  fill: ManagedColor;
  /** How many text nodes use this style. */
  count: number;
}

/** Information about an asset (image/icon) used in the document. */
export interface SpecAsset {
  nodeId: NodeId;
  name: string;
  /** SHA-256-like content hash (first 8 chars) for dedup. */
  contentHash: string;
  size: { w: number; h: number };
}

/** Resolved spacing/padding for a single node. */
export interface SpecNodeDetail {
  nodeId: NodeId;
  name: string;
  kind: string;
  /** Indentation depth for nesting. */
  depth: number;
  /** Resolved bounding box (from transform + shape size). */
  rect: { x: number; y: number; w: number; h: number };
  /** Frame padding, if applicable. */
  padding?: [number, number, number, number];
  /** Gap between children, if applicable. */
  gap?: number;
  /** Resolved fill color. */
  fill?: ManagedColor;
  /** Text content (if text node). */
  text?: string;
  fontSize?: number;
}

/** The complete spec sheet for a document. */
export interface SpecSheet {
  /** All spacing values used (aggregated). */
  spacings: SpecSpacing[];
  /** All type styles used (aggregated). */
  typeStyles: SpecTypeStyle[];
  /** Assets used in the document. */
  assets: SpecAsset[];
  /** Detailed per-node spec. */
  nodes: SpecNodeDetail[];
  /** Aggregate color palette. */
  palette: ManagedColor[];
}

function approxShapeSize(node: SceneNode): { w: number; h: number } {
  if (node.kind === 'shape') {
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return { w: s.w, h: s.h };
      case 'ellipse':
        return { w: s.rx * 2, h: s.ry * 2 };
      case 'circle':
        return { w: s.r * 2, h: s.r * 2 };
      case 'line':
        return { w: Math.abs(s.to[0] - s.from[0]), h: Math.abs(s.to[1] - s.from[1]) };
    }
  }
  if (node.kind === 'frame') {
    // Use transform position as approximate; children determine actual size
    return { w: 100, h: 100 };
  }
  if (node.kind === 'text') {
    return { w: node.text.length * node.fontSize * 0.6, h: node.fontSize * 1.4 };
  }
  return { w: 0, h: 0 };
}

/**
 * Build a spec sheet from a Document.
 * Collects aggregated spacing values, type styles, assets, and per-node details.
 */
export function buildSpec(doc: Document): SpecSheet {
  const spacings = new Map<string, { name: string; value: number; count: number }>();
  const typeStyles = new Map<string, SpecTypeStyle>();
  const assets: SpecAsset[] = [];
  const nodes: SpecNodeDetail[] = [];
  const paletteMap = new Map<string, ManagedColor>();

  function addSpacing(name: string, value: number) {
    const key = name || `${value}`;
    const existing = spacings.get(key);
    if (existing) {
      existing.count++;
    } else {
      spacings.set(key, { name: key, value, count: 1 });
    }
  }

  function addColor(color: ManagedColor) {
    const [r, g, b, a] = managedColorToRgba(color);
    const key = `${r},${g},${b},${a}`;
    if (!paletteMap.has(key)) {
      paletteMap.set(key, color);
    }
  }

  function walk(ids: NodeId[], depth: number) {
    for (const nid of ids) {
      const node = doc.nodes[nid];
      if (!node) continue;

      addColor(node.fill);

      const size = approxShapeSize(node);
      const x = node.transform[4] ?? 0;
      const y = node.transform[5] ?? 0;

      const detail: SpecNodeDetail = {
        nodeId: node.id,
        name: node.name,
        kind: node.kind,
        depth,
        rect: { x, y, w: size.w, h: size.h },
        fill: node.fill,
      };

      if (node.kind === 'frame') {
        // Estimate padding from transform offset vs children positions
        // For now this is a stub; real padding extraction needs layout data
        if (node.children.length > 0) {
          addSpacing('frame-padding', 0);
        }
        detail.padding = [0, 0, 0, 0];
        detail.gap = 0;
        nodes.push(detail);
        walk(node.children, depth + 1);
        continue;
      }

      if (node.kind === 'text') {
        detail.text = node.text;
        detail.fontSize = node.fontSize;

        const typeKey = `${node.fontSize}`;
        let ts = typeStyles.get(typeKey);
        if (!ts) {
          ts = {
            id: `type-${typeKey}`,
            name: `${node.fontSize}px`,
            fontSize: node.fontSize,
            fill: node.fill,
            count: 0,
          };
          typeStyles.set(typeKey, ts);
        }
        ts.count++;

        nodes.push(detail);
        continue;
      }

      // Shape node
      nodes.push(detail);
    }
  }

  walk(doc.rootChildren, 0);

  return {
    spacings: Array.from(spacings.values()).sort((a, b) => b.count - a.count),
    typeStyles: Array.from(typeStyles.values()).sort((a, b) => b.count - a.count),
    assets,
    nodes,
    palette: Array.from(paletteMap.values()),
  };
}

/** Format a spec sheet as markdown for clipboard export. */
export function specToMarkdown(spec: SpecSheet): string {
  const lines: string[] = ['# Design Spec', ''];

  if (spec.typeStyles.length > 0) {
    lines.push('## Type Styles');
    for (const t of spec.typeStyles) {
      lines.push(`- **${t.name}**: ${t.fontSize}px, used ${t.count}x`);
    }
    lines.push('');
  }

  if (spec.spacings.length > 0) {
    lines.push('## Spacing');
    for (const s of spec.spacings) {
      lines.push(`- ${s.value}px, used ${s.count}x`);
    }
    lines.push('');
  }

  if (spec.palette.length > 0) {
    lines.push('## Colors');
    for (const c of spec.palette) {
      const [r, g, b, a] = managedColorToRgba(c);
      lines.push(`- rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
