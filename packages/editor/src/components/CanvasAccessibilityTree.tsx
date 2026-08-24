/**
 * Canvas Accessibility Tree — hidden DOM representation of canvas nodes
 * for screen-reader navigation.
 *
 * Instead of treating the entire canvas as one opaque image (`role="img"`),
 * each visible node gets a hidden list item with an `aria-label` describing
 * its name, kind, position, and size.
 *
 * Research basis: WCAG 2.2 §1.1.1 (Non-text Content), WAI-ARIA img role,
 * and Figma's undocumented accessibility tree (inferred behaviour).
 */

import type { Document, NodeId } from '@varve/scene';
import { buildParentIndexMap } from '@varve/scene';
import { useMemo } from 'react';

interface CanvasAccessibilityTreeProps {
  doc: Document;
  camera: { zoom: number; pan: { x: number; y: number } };
  viewport: { width: number; height: number };
  walkNodes: (doc: Document) => Map<string, { depth: number; parentId: string | null }>;
  nodeWorldBounds: (
    doc: Document,
    id: string,
    parentIndex?: Map<NodeId, NodeId>,
  ) => { x: number; y: number; w: number; h: number } | null;
  isWorldRectInViewport: (
    cam: { zoom: number; pan: { x: number; y: number } },
    vp: { width: number; height: number },
    rect: { x: number; y: number; w: number; h: number },
  ) => boolean;
}

export function CanvasAccessibilityTree({
  doc,
  camera,
  viewport,
  walkNodes,
  nodeWorldBounds,
  isWorldRectInViewport,
}: CanvasAccessibilityTreeProps) {
  const visibleNodes = useMemo(() => {
    const entries = walkNodes(doc);
    // nodeWorldBounds falls back to an O(n) linear scan (getParent) per call
    // when no parentIndex is passed. Called once per node here, that made
    // this memo O(n^2) in node count on every doc/camera/viewport change.
    const parentIndex = buildParentIndexMap(doc);
    const result: Array<{
      id: string;
      name: string;
      kind: string;
      depth: number;
      x: number;
      y: number;
      w: number;
      h: number;
      backgroundRemoved: boolean;
      bgRemovalMethod?: string;
    }> = [];

    for (const [id, info] of entries) {
      const n = doc.nodes[id];
      if (!n || n.visible === false) continue;
      const bounds = nodeWorldBounds(doc, id, parentIndex);
      if (!bounds) continue;
      if (!isWorldRectInViewport(camera, viewport, bounds)) continue;
      const bgRemoval =
        'backgroundRemoval' in n && n.backgroundRemoval != null
          ? (n.backgroundRemoval as { method?: string })
          : null;
      result.push({
        id,
        name: n.name ?? 'Untitled',
        kind: n.kind,
        depth: info?.depth ?? 0,
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        w: Math.round(bounds.w),
        h: Math.round(bounds.h),
        backgroundRemoved: bgRemoval != null,
        bgRemovalMethod: bgRemoval?.method,
      });
    }

    return result;
  }, [doc, camera, viewport, walkNodes, nodeWorldBounds, isWorldRectInViewport]);

  if (visibleNodes.length === 0) {
    return <div aria-hidden="false" className="sr-only" />;
  }

  return (
    <div aria-hidden="false" className="sr-only">
      <ul aria-label="Canvas objects">
        {visibleNodes.map((node) => (
          <li
            key={node.id}
            aria-label={`${node.name}, ${node.kind}, at (${node.x}, ${node.y}), ${node.w} x ${node.h}${
              node.backgroundRemoved
                ? `, background removed (${node.bgRemovalMethod === 'quick' ? 'quick' : 'AI'})`
                : ''
            }`}
          />
        ))}
      </ul>
    </div>
  );
}
