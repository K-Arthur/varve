/**
 * Canvas Accessibility Tree — hidden DOM representation of canvas nodes
 * for screen-reader navigation.
 *
 * Instead of treating the entire canvas as one opaque image (`role="img"`),
 * each visible node gets a hidden `<span>` with `role="img"` and an
 * `aria-label` describing its name, kind, position, and size.
 *
 * Research basis: WCAG 2.2 §1.1.1 (Non-text Content), WAI-ARIA img role,
 * and Figma's undocumented accessibility tree (inferred behaviour).
 */

import type { Document } from '@strata/scene';
import { useMemo } from 'react';

interface CanvasAccessibilityTreeProps {
  doc: Document;
  camera: { zoom: number; pan: { x: number; y: number } };
  viewport: { width: number; height: number };
  walkNodes: (doc: Document) => Map<string, { depth: number; parentId: string | null }>;
  nodeWorldBounds: (
    doc: Document,
    id: string,
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
    const result: Array<{
      id: string;
      name: string;
      kind: string;
      x: number;
      y: number;
      w: number;
      h: number;
      backgroundRemoved: boolean;
      bgRemovalMethod?: string;
    }> = [];

    for (const [id] of entries) {
      const n = doc.nodes[id];
      if (!n || n.visible === false) continue;
      const bounds = nodeWorldBounds(doc, id);
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
      {visibleNodes.map((node) => (
        <span
          key={node.id}
          role="img"
          aria-label={`${node.name}, ${node.kind}, at (${node.x}, ${node.y}), ${node.w} x ${node.h}${
            node.backgroundRemoved
              ? `, background removed (${node.bgRemovalMethod === 'quick' ? 'quick' : 'AI'})`
              : ''
          }`}
        />
      ))}
    </div>
  );
}
