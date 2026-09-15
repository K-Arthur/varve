/**
 * Paint helpers — the bridge between first-class Paint entities and inline fills.
 *
 * V1.8+: Paint is a Fill with identity (id, name) stored in Document.paints.
 * Nodes reference paints via paintRefs[] on NodeBase. This module provides
 * resolution logic: "given a node and a document, what are the effective fills?"
 *
 * The resolution precedence chain is:
 *   1. paintRefs → Document.paints (v1.8+ shared paints)
 *   2. fills[] (v1.5+ inline stacked fills)
 *   3. fill (v1.0 legacy single color)
 *
 * Research basis: Figma/Sketch fill stacks (paint order bottom→top), extended
 * so that a fill can be independently addressable and shared across nodes.
 */

import { solidFill } from './fills';
import type { Fill, Paint } from './types';

/**
 * Resolve a node's effective fill stack, including paintRefs indirection.
 *
 * Resolution precedence chain:
 *   1. paintRefs → Document.paints (v1.8+ shared paints)
 *      - When paintRefs is a non-empty array, ONLY those references are used.
 *        Non-resolving references are silently skipped. If none resolve, an
 *        empty array is returned (no fallback to inline fills).
 *   2. fills[] (v1.5+ inline stacked fills) — only checked if paintRefs is
 *      undefined or empty.
 *   3. fill (v1.0 legacy single color) — only checked if neither paintRefs
 *      nor fills are available.
 */
/**
 * Note: The `fill` parameter accepts the structural superset of all ManagedColor
 * variants (RgbColor has r/g/b, CmykColor has c/m/y/k, GrayColor has gray,
 * SpotColor has spotColor/spotTint). We pass it to solidFill() which expects
 * a full ManagedColor — the cast is safe because at runtime the value will
 * always be one of the ManagedColor variants, and solidFill just reads what
 * exists and spreads defaults for missing fields.
 */
export function resolveNodePaints(
  node: { paintRefs?: string[]; fills?: Fill[]; fill?: Record<string, unknown> },
  doc: { paints?: Record<string, Paint> },
): Fill[] {
  // Level 1: paintRefs → Document.paints
  if (node.paintRefs && node.paintRefs.length > 0) {
    const resolved: Fill[] = [];
    if (doc.paints) {
      for (const refId of node.paintRefs) {
        const paint = doc.paints[refId];
        if (paint) {
          resolved.push(paint.fill);
        }
      }
    }
    // paintRefs is explicitly set — return only what we resolved,
    // even if the array is empty. No fallback to inline fills.
    return resolved;
  }

  // Level 2: inline fills[]
  if (node.fills && node.fills.length > 0) return node.fills;

  // Level 3: legacy fill color
  return [solidFill(node.fill as unknown as import('./colorManagement').ManagedColor)];
}

/**
 * Compute the derived geometry (Shape) for a shapeless node.
 *
 * When a ShapeNode has `shapeless: true`, its geometry is determined by its
 * paint rather than by an explicit shape. This is how images become
 * first-class objects: an image paint's natural dimensions define the node's
 * bounds, with no host rect required.
 *
 * Resolution order per paint type:
 * - image: natural dimensions from ImageFillData (imageWidth × imageHeight),
 *          falling back to 100×100
 * - solid/gradient: 100×100 default rect (the content defines its own bounds)
 * - pattern: 100×100 default rect
 */
export function deriveGeometryFromPaints(fills: Fill[]): {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
} {
  // Use the first visible fill
  for (const f of fills) {
    if (!f.visible) continue;
    if (f.type === 'image' && f.image) {
      const w = f.image.imageWidth ?? 100;
      const h = f.image.imageHeight ?? 100;
      return { kind: 'rect', x: 0, y: 0, w, h };
    }
  }
  // Default: 100×100 for non-image paints or invisible fills
  return { kind: 'rect', x: 0, y: 0, w: 100, h: 100 };
}

/**
 * Extract the natural image dimensions from a list of fills.
 * Returns { w, h } from the first visible image fill, or null if none.
 */
export function getPaintImageDimensions(fills: Fill[]): { w: number; h: number } | null {
  for (const f of fills) {
    if (!f.visible) continue;
    if (f.type === 'image' && f.image) {
      const w = f.image.imageWidth;
      const h = f.image.imageHeight;
      if (w && h) return { w, h };
    }
  }
  return null;
}
