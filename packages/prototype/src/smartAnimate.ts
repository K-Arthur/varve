/**
 * Smart Animate layer matching — pairs layers by name across screens.
 *
 * Extracts per-layer property deltas (position, size, opacity, rotation,
 * corner radius, fill color, stroke weight) so the renderer can interpolate
 * between matched layers across screens.
 */
import type { NodeId, SceneNode } from '@strata/scene';

export interface LayerMatch {
  fromId: NodeId;
  toId: NodeId;
  name: string;
}

/**
 * Per-property from/to pair for a single interpolated value.
 * Used when both values are present; omitted when a property is absent on
 * either side (meaning no interpolation is possible for that property).
 */
export interface PropertyPair<T> {
  from: T;
  to: T;
}

/**
 * Complete set of interpolatable properties for a matched layer pair.
 * Each property contains a from/to pair for linear interpolation at progress t.
 *
 * Backward-compatible: code that only reads `opacity` and `transform` is
 * unaffected. New properties are additive extensions.
 */
export interface SmartAnimateLayerValues {
  opacity: PropertyPair<number>;
  transform: PropertyPair<import('@strata/engine').Affine>;
  /** Rotation in degrees. */
  rotation?: PropertyPair<number>;
  /** Uniform corner radius (px). undefined when corners are not uniform. */
  cornerRadius?: PropertyPair<number>;
  /** Primary fill color as an RGBA tuple [r, g, b, a] (0-255). */
  fill?: PropertyPair<[number, number, number, number]>;
  /** Stroke weight in px (first visible stroke). */
  strokeWidth?: PropertyPair<number>;
}

/** Match direct children of two frame roots by node name. */
export function matchLayersByName(
  nodes: Record<NodeId, SceneNode>,
  fromRootId: NodeId,
  toRootId: NodeId,
): LayerMatch[] {
  const fromRoot = nodes[fromRootId];
  const toRoot = nodes[toRootId];
  if (!fromRoot || !toRoot || !('children' in fromRoot) || !('children' in toRoot)) {
    return [];
  }

  const toByName = new Map<string, NodeId>();
  for (const id of toRoot.children ?? []) {
    const n = nodes[id];
    if (n) toByName.set(n.name, id);
  }

  const matches: LayerMatch[] = [];
  for (const fromId of fromRoot.children ?? []) {
    const fromNode = nodes[fromId];
    if (!fromNode) continue;
    const toId = toByName.get(fromNode.name);
    if (toId) {
      matches.push({ fromId, toId, name: fromNode.name });
    }
  }
  return matches;
}

/**
 * Build smart-animate value map from opacity/transform/rotation/corner/fill/stroke
 * deltas for matched layers.
 *
 * Extracts every interpolatable property from each matched layer pair.
 * Properties that are absent on *both* sides are omitted (no from/to pair).
 * Properties absent on only one side are still emitted with the present value
 * as both from and to, which yields a no-op interpolation — safe and backward-compatible.
 */
export function buildSmartAnimateValues(
  nodes: Record<NodeId, SceneNode>,
  matches: LayerMatch[],
): Record<string, SmartAnimateLayerValues> {
  const result: Record<string, SmartAnimateLayerValues> = {};
  for (const m of matches) {
    const from = nodes[m.fromId];
    const to = nodes[m.toId];
    if (!from || !to) continue;

    const layer: SmartAnimateLayerValues = {
      opacity: { from: from.opacity ?? 1, to: to.opacity ?? 1 },
      transform: { from: from.transform, to: to.transform },
    };

    // Rotation (degrees). Default 0 for both.
    layer.rotation = { from: from.rotation ?? 0, to: to.rotation ?? 0 };

    // Corner radius — only interpolate when both are uniform numbers
    // (only present on ShapeNode and FrameNode).
    if ('cornerRadius' in from && 'cornerRadius' in to) {
      const fromCorners = from.cornerRadius;
      const toCorners = to.cornerRadius;
      if (typeof fromCorners === 'number' && typeof toCorners === 'number') {
        layer.cornerRadius = { from: fromCorners, to: toCorners };
      }
    }

    // Fill colour — extract the first visible solid fill's RGBA tuple.
    const fromFill = extractFillRgba(from);
    const toFill = extractFillRgba(to);
    if (fromFill && toFill) {
      layer.fill = { from: fromFill, to: toFill };
    }

    // Stroke weight — first visible stroke's weight
    // (only present on ShapeNode and TextNode).
    if ('strokes' in from && 'strokes' in to) {
      const fromStroke = extractStrokeWeight(from.strokes);
      const toStroke = extractStrokeWeight(to.strokes);
      if (fromStroke !== undefined && toStroke !== undefined) {
        layer.strokeWidth = { from: fromStroke, to: toStroke };
      }
    }

    result[m.name] = layer;
  }
  return result;
}

/**
 * Extract the primary fill colour as an RGBA tuple from a node.
 *
 * Prefers the first visible fill in `fills[]` (ShapeNode/TextNode only);
 * falls back to the legacy `fill` (ManagedColor) on the node. Returns
 * undefined when the fill cannot be expressed as an RGB colour (e.g.
 * image/pattern fills, or nodes without fills).
 */
function extractFillRgba(node: SceneNode): [number, number, number, number] | undefined {
  // Stacked fills: only present on ShapeNode and TextNode.
  if ('fills' in node && node.fills && node.fills.length > 0) {
    for (const f of node.fills) {
      if (f.type === 'solid' && f.visible && f.color?.space === 'rgb') {
        return [f.color.r, f.color.g, f.color.b, Math.round(f.color.a * f.opacity)];
      }
    }
    // No visible solid fill found — skip fill interpolation.
    return undefined;
  }

  // Legacy single fill: ManagedColor directly on the node.
  const c = node.fill;
  if (!c) return undefined;
  if (c.space === 'rgb') return [c.r, c.g, c.b, c.a];
  if (c.space === 'cmyk') {
    // CMYK → sRGB best-effort (no ICC context here).
    const r = Math.round(255 * (1 - c.c / 255) * (1 - c.k / 255));
    const g = Math.round(255 * (1 - c.m / 255) * (1 - c.k / 255));
    const b = Math.round(255 * (1 - c.y / 255) * (1 - c.k / 255));
    return [r, g, b, c.a];
  }
  if (c.space === 'gray') return [c.v, c.v, c.v, c.a];
  // Spot: use tint as alpha fallback.
  if (c.space === 'spot') {
    const alpha = Math.round(c.a * (c.tint / 100));
    if (c.processFallback) {
      const r = Math.round(255 * (1 - c.processFallback.c / 255) * (1 - c.processFallback.k / 255));
      const g = Math.round(255 * (1 - c.processFallback.m / 255) * (1 - c.processFallback.k / 255));
      const b = Math.round(255 * (1 - c.processFallback.y / 255) * (1 - c.processFallback.k / 255));
      return [r, g, b, alpha];
    }
    return [0, 0, 0, alpha];
  }
  return undefined;
}

/**
 * Extract the stroke weight (px) from the first visible stroke in an array,
 * or undefined if no visible stroke exists.
 */
function extractStrokeWeight(
  strokes: { visible: boolean; weight: number }[] | undefined,
): number | undefined {
  if (!strokes || strokes.length === 0) return undefined;
  for (const s of strokes) {
    if (s.visible) return s.weight;
  }
  return undefined;
}
