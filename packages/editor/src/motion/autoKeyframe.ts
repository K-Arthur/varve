/**
 * Auto-keyframe insertion during timeline playback.
 *
 * When autoKeyframe mode is active and the user edits a property on a selected
 * node while the timeline is playing, a keyframe is inserted at the current
 * playhead position.
 */

import {
  addKeyframe,
  addTrack,
  type Document,
  getNestedValue,
  type NodeId,
  type SceneNode,
} from '@strata/scene';

export interface AutoKeyframeContext {
  autoKeyframe: boolean;
  isPlaying: boolean;
  activeTimelineId: string | null;
  currentTime: number;
  selection: NodeId[];
}

export function shouldAutoKeyframe(ctx: AutoKeyframeContext): boolean {
  return (
    ctx.autoKeyframe && ctx.isPlaying && ctx.activeTimelineId !== null && ctx.selection.length > 0
  );
}

function getPropertyValueAt(node: SceneNode, property: string): unknown {
  if (property === 'opacity') return node.opacity;
  if (property === 'rotation') return node.rotation;
  if (property === 'skewX') {
    const [a, b, c, d] = node.transform ?? [1, 0, 0, 1, 0, 0];
    const sx = Math.hypot(a, b);
    if (sx < 1e-10) return 0;
    return (a * c + b * d) / (sx * sx);
  }
  if (property === 'skewY') {
    const [a, b, c, d] = node.transform ?? [1, 0, 0, 1, 0, 0];
    const sy = Math.hypot(c, d);
    if (sy < 1e-10) return 0;
    return -(a * c + b * d) / (sy * sy);
  }
  if (property === 'fill' || property.startsWith('fill[')) return node.fill;
  if (property === 'transform' || property.startsWith('transform[')) {
    return node.transform ?? [1, 0, 0, 1, 0, 0];
  }
  if ('w' in node && property === 'w') return (node as { w: number }).w;
  if ('h' in node && property === 'h') return (node as { h: number }).h;
  if (property === 'fontSize' && 'fontSize' in node) return (node as { fontSize: number }).fontSize;
  return getNestedValue(node as unknown as Record<string, unknown>, property.split('.')) ?? 0;
}

/** Insert or update keyframes at the current playhead for the given property. */
export function applyAutoKeyframes(
  doc: Document,
  ctx: AutoKeyframeContext,
  property: string,
): Document {
  if (!shouldAutoKeyframe(ctx) || !ctx.activeTimelineId) return doc;

  const tlId = ctx.activeTimelineId;
  let d = doc;
  const timeline = d.timelines?.[tlId];
  if (!timeline) return d;

  const progress = timeline.duration > 0 ? ctx.currentTime / timeline.duration : 0;

  for (const nodeId of ctx.selection) {
    const node = d.nodes[nodeId];
    if (!node) continue;

    const existingTrack = timeline.tracks.find(
      (t) => t.nodeId === nodeId && t.property === property,
    );

    if (existingTrack) {
      d = addKeyframe(d, tlId, existingTrack.id, {
        progress,
        value: getPropertyValueAt(node, property),
      });
    } else {
      const { doc: d2, trackId } = addTrack(d, tlId, nodeId, property);
      d = addKeyframe(d2, tlId, trackId, {
        progress,
        value: getPropertyValueAt(node, property),
      });
    }
  }

  return d;
}
