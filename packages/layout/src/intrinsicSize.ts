/**
 * Bottom-up intrinsic ("hug contents") sizing for nested auto-layout frames.
 *
 * A hug-sized frame's own box is derived from its flow children's natural
 * sizes plus its own gap/padding — recursively, so a hug frame nested inside
 * another hug frame resolves correctly. Frames are visited in post-order
 * (deepest first) so a parent's measurement always sees its children's
 * already-resolved sizes.
 *
 * Cycle-breaking policy (see cycleDetection.ts for the companion diagnostic):
 * a fill/grow child contributes its minWidth/minHeight (or 0) to its parent's
 * hug measurement, never its would-be-expanded size — a fill child's size is
 * only known once the parent's box is known, which is exactly what hug
 * measurement is trying to determine, so the cycle is broken by definition
 * rather than detected and rejected.
 */
import type { Document, FrameNode, NodeId, SceneNode } from '@varve/scene';
import { axisSizing, clampAxis, isFlowParticipant, measureNodeSize, type Size } from './measure';

function axisContribution(child: SceneNode, axis: 'width' | 'height', natural: number): number {
  if (axisSizing(child, axis) !== 'fill') return natural;
  return (axis === 'width' ? child.minWidth : child.minHeight) ?? 0;
}

/** A hug frame's content size from its current (already-resolved) flow children. */
function computeFrameContentSize(nodes: Record<NodeId, SceneNode>, frame: FrameNode): Size {
  const style = frame.layoutStyle!;
  const [pt, pr, pb, pl] = style.padding;
  const gap = style.gap;
  const row = style.direction === 'row' || style.direction === 'rowReverse';

  const flowChildren = frame.children
    .map((cid) => nodes[cid])
    .filter((n): n is SceneNode => n !== undefined && isFlowParticipant(n));

  let mainSum = 0;
  let crossMax = 0;
  for (const child of flowChildren) {
    const sz = measureNodeSize(child);
    const mainNatural = row ? sz.w : sz.h;
    const crossNatural = row ? sz.h : sz.w;
    mainSum += axisContribution(child, row ? 'width' : 'height', mainNatural);
    crossMax = Math.max(crossMax, axisContribution(child, row ? 'height' : 'width', crossNatural));
  }
  mainSum += Math.max(0, flowChildren.length - 1) * gap;

  return row
    ? { w: mainSum + pl + pr, h: crossMax + pt + pb }
    : { w: crossMax + pl + pr, h: mainSum + pt + pb };
}

/**
 * Resolve hug-sized frame boxes across `rootId`'s subtree (bottom-up), for
 * every axis whose sizing mode is 'hug'. Non-hug axes and non-frame nodes
 * are left untouched. Grid-mode frames are skipped — grid intrinsic sizing
 * is not yet implemented; they keep their authored box.
 */
export function resolveIntrinsicSizes(doc: Document, rootId: NodeId): Document {
  const root = doc.nodes[rootId];
  if (root?.kind !== 'frame') return doc;

  const order: NodeId[] = [];
  const visited = new Set<NodeId>();
  const visit = (id: NodeId): void => {
    if (visited.has(id)) return; // guards malformed/cyclic children arrays
    visited.add(id);
    const n = doc.nodes[id];
    if (n?.kind !== 'frame') return;
    for (const cid of n.children) visit(cid);
    order.push(id);
  };
  visit(rootId);

  let nodes = doc.nodes;
  for (const id of order) {
    const frame = nodes[id];
    if (frame?.kind !== 'frame' || !frame.layoutStyle) continue;
    if (frame.layoutStyle.mode === 'grid') continue;
    const hugW = axisSizing(frame, 'width') === 'hug';
    const hugH = axisSizing(frame, 'height') === 'hug';
    if (!hugW && !hugH) continue;

    const content = computeFrameContentSize(nodes, frame);
    const nextW = hugW ? clampAxis(content.w, frame, 'width') : frame.w;
    const nextH = hugH ? clampAxis(content.h, frame, 'height') : frame.h;
    if (nextW !== frame.w || nextH !== frame.h) {
      nodes = { ...nodes, [id]: { ...frame, w: nextW, h: nextH } };
    }
  }

  return nodes === doc.nodes ? doc : { ...doc, nodes };
}
