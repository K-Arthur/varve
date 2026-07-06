/**
 * Smart Animate bridge — computes layer match values for screen transitions.
 */
import type { LayerMatch } from '@strata/prototype';
import { buildSmartAnimateValues, matchLayersByName } from '@strata/prototype';
import type { Document, NodeId, SceneNode } from '@strata/scene';
import type { EasingDefinition } from '@strata/shared';
import { getEasingFn } from '@strata/shared';

export interface SmartAnimateTransition {
  fromScreenId: NodeId;
  toScreenId: NodeId;
  values: Record<string, Record<string, unknown>>;
  matches: LayerMatch[];
}

export interface HotspotTransitionOverride {
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
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
 */
export function computeSmartAnimateHotspotOverrides(
  doc: Document,
  matches: LayerMatch[],
  smartAnimateValues: Record<string, Record<string, unknown>>,
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

    const opacityVal = layerValues?.opacity as { from?: number; to?: number } | undefined;
    const fromOpacity = opacityVal?.from ?? 1;
    const toOpacity = opacityVal?.to ?? 1;

    const x = lerp(fromLayout.x, toLayout.x, easedT);
    const y = lerp(fromLayout.y, toLayout.y, easedT);
    const w = lerp(fromLayout.w, toLayout.w, easedT);
    const h = lerp(fromLayout.h, toLayout.h, easedT);
    const blendedOpacity = lerp(fromOpacity, toOpacity, easedT);

    from[match.fromId] = {
      left: x,
      top: y,
      width: w,
      height: h,
      opacity: blendedOpacity * (1 - easedT),
    };
    to[match.toId] = {
      left: x,
      top: y,
      width: w,
      height: h,
      opacity: blendedOpacity * easedT,
    };
  }

  return { from, to };
}
