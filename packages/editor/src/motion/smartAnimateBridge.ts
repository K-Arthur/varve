/**
 * Smart Animate bridge — computes layer match values for screen transitions.
 *
 * Interpolates per-layer property deltas (position, size, opacity, rotation,
 * corner radius, fill colour, stroke weight) between two frame screens so
 * matched layers morph smoothly.
 */
import type { LayerMatch, SmartAnimateLayerValues } from '@varve/prototype';
import { buildSmartAnimateValues, matchLayersByName } from '@varve/prototype';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import type { EasingDefinition } from '@varve/shared';
import { getEasingFn, interpolateColor } from '@varve/shared';

export interface SmartAnimateTransition {
  fromScreenId: NodeId;
  toScreenId: NodeId;
  values: Record<string, SmartAnimateLayerValues>;
  matches: LayerMatch[];
}

export interface HotspotTransitionOverride {
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  /** Rotation in degrees. */
  rotation: number;
  /** Uniform corner radius in px. 0 when not interpolated. */
  cornerRadius: number;
  /** Fill colour as a CSS colour string. Empty string when not interpolated. */
  fill: string;
  /** Stroke weight in px. 0 when not interpolated. */
  strokeWidth: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hotspotLayout(
  nodeId: NodeId,
  nodes: Record<NodeId, SceneNode>,
  getBounds: (id: NodeId) => { x: number; y: number; w: number; h: number } | null,
): { x: number; y: number; w: number; h: number } | null {
  const node = nodes[nodeId];
  const bounds = getBounds(nodeId);
  if (!node || !bounds) return null;
  const tx = node.transform?.[4] ?? 0;
  const ty = node.transform?.[5] ?? 0;
  return { x: tx + bounds.x, y: ty + bounds.y, w: bounds.w, h: bounds.h };
}

/** Compute smart-animate property deltas between two frame screens. */
export function computeSmartAnimateTransition(
  doc: Document,
  fromScreenId: NodeId,
  toScreenId: NodeId,
): SmartAnimateTransition | null {
  const matches = matchLayersByName(doc.nodes, fromScreenId, toScreenId);
  if (matches.length === 0) return null;
  const values = buildSmartAnimateValues(doc.nodes, matches);
  return { fromScreenId, toScreenId, values, matches };
}

/**
 * Per-layer hotspot styles for dual-screen Smart Animate (matched layers morph in place).
 *
 * Interpolates position (x/y), size (w/h), opacity, rotation, corner radius,
 * fill colour, and stroke weight for every matched layer pair at the given
 * progress [0, 1] using the supplied easing curve.
 */
export function computeSmartAnimateHotspotOverrides(
  doc: Document,
  matches: LayerMatch[],
  smartAnimateValues: Record<string, SmartAnimateLayerValues>,
  progress: number,
  easing: EasingDefinition,
  getBounds: (nodeId: NodeId) => { x: number; y: number; w: number; h: number } | null,
): {
  from: Record<NodeId, HotspotTransitionOverride>;
  to: Record<NodeId, HotspotTransitionOverride>;
} {
  const easedT = getEasingFn(easing)(progress);
  const from: Record<NodeId, HotspotTransitionOverride> = {};
  const to: Record<NodeId, HotspotTransitionOverride> = {};

  for (const match of matches) {
    const layerValues = smartAnimateValues[match.name];
    const fromLayout = hotspotLayout(match.fromId, doc.nodes, getBounds);
    const toLayout = hotspotLayout(match.toId, doc.nodes, getBounds);
    if (!fromLayout || !toLayout) continue;

    const opacityVal = layerValues?.opacity;
    const fromOpacity = opacityVal?.from ?? 1;
    const toOpacity = opacityVal?.to ?? 1;

    const x = lerp(fromLayout.x, toLayout.x, easedT);
    const y = lerp(fromLayout.y, toLayout.y, easedT);
    const w = lerp(fromLayout.w, toLayout.w, easedT);
    const h = lerp(fromLayout.h, toLayout.h, easedT);
    const blendedOpacity = lerp(fromOpacity, toOpacity, easedT);

    // Rotation (degrees).
    const fromRotation = layerValues?.rotation?.from ?? 0;
    const toRotation = layerValues?.rotation?.to ?? 0;
    const rotation = lerp(fromRotation, toRotation, easedT);

    // Corner radius (uniform px).
    const fromCornerRadius = layerValues?.cornerRadius?.from ?? 0;
    const toCornerRadius = layerValues?.cornerRadius?.to ?? 0;
    const cornerRadius = lerp(fromCornerRadius, toCornerRadius, easedT);

    // Fill colour — interpolate RGBA tuples, convert to CSS string.
    let fill = '';
    if (layerValues?.fill) {
      const fromRgba = layerValues.fill.from;
      const toRgba = layerValues.fill.to;
      const interpolated = interpolateColor(fromRgba, toRgba, easedT);
      if (Array.isArray(interpolated) && interpolated.length >= 4) {
        const [r, g, b, a] = interpolated as [number, number, number, number];
        fill = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${(a / 255).toFixed(3)})`;
      }
    }

    // Stroke weight (px).
    const fromStrokeWidth = layerValues?.strokeWidth?.from ?? 0;
    const toStrokeWidth = layerValues?.strokeWidth?.to ?? 0;
    const strokeWidth = lerp(fromStrokeWidth, toStrokeWidth, easedT);

    const override: HotspotTransitionOverride = {
      left: x,
      top: y,
      width: w,
      height: h,
      opacity: blendedOpacity,
      rotation,
      cornerRadius,
      fill,
      strokeWidth,
    };

    from[match.fromId] = {
      ...override,
      opacity: blendedOpacity * (1 - easedT),
    };
    to[match.toId] = {
      ...override,
      opacity: blendedOpacity * easedT,
    };
  }

  return { from, to };
}
