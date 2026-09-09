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

import type {
  Document,
  MultipageNodeInstance,
  NodeId,
  ResolvedEditorSceneScope,
} from '@varve/scene';
import { assertOccurrencesInScope, buildParentIndexMap } from '@varve/scene';
import { useMemo } from 'react';

interface CanvasAccessibilityTreeProps {
  doc: Document;
  camera: { zoom: number; pan: { x: number; y: number }; rotation?: number };
  viewport: { width: number; height: number };
  /** Preferred current-surface projection. */
  scope?: ResolvedEditorSceneScope;
  /** Legacy test/consumer seam; current editor wiring passes `scope`. */
  walkNodes?: (doc: Document) => Map<string, { depth: number; parentId: string | null }>;
  nodeWorldBounds: (
    doc: Document,
    id: string,
    parentIndex?: Map<NodeId, NodeId>,
  ) => { x: number; y: number; w: number; h: number } | null;
  isWorldRectInViewport: (
    cam: { zoom: number; pan: { x: number; y: number }; rotation?: number },
    vp: { width: number; height: number },
    rect: { x: number; y: number; w: number; h: number },
  ) => boolean;
}

export function CanvasAccessibilityTree({
  doc,
  camera,
  viewport,
  scope,
  walkNodes,
  nodeWorldBounds,
  isWorldRectInViewport,
}: CanvasAccessibilityTreeProps) {
  const visibleNodes = useMemo(() => {
    type AccessibilityEntry = {
      nodeId: string;
      depth: number;
      parentId: string | null;
      entry?: MultipageNodeInstance;
    };
    const entries = scope
      ? new Map<string, AccessibilityEntry>(
          scope.occurrences.map((entry) => [
            entry.instanceId,
            { nodeId: entry.nodeId, depth: entry.depth, parentId: entry.parentId, entry },
          ]),
        )
      : new Map<string, AccessibilityEntry>(
          [...(walkNodes?.(doc) ?? [])].map(([id, info]) => [id, { ...info, nodeId: id }]),
        );
    // nodeWorldBounds falls back to an O(n) linear scan (getParent) per call
    // when no parentIndex is passed. Called once per node here, that made
    // this memo O(n^2) in node count on every doc/camera/viewport change.
    const parentIndex = buildParentIndexMap(doc);
    const result: Array<{
      id: string;
      nodeId: string;
      surfaceKey?: string;
      instanceId: string;
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
      const occurrence = 'entry' in info ? info.entry : undefined;
      const nodeId = info.nodeId;
      const n = doc.nodes[nodeId];
      if (!n || n.visible === false) continue;
      let bounds = nodeWorldBounds(doc, nodeId, parentIndex);
      if (bounds && occurrence?.masterPlacement) {
        bounds = {
          ...bounds,
          x: bounds.x + occurrence.masterPlacement.x,
          y: bounds.y + occurrence.masterPlacement.y,
        };
      }
      if (!bounds) continue;
      if (!isWorldRectInViewport(camera, viewport, bounds)) continue;
      const bgRemoval =
        'backgroundRemoval' in n && n.backgroundRemoval != null
          ? (n.backgroundRemoval as { method?: string })
          : null;
      result.push({
        id,
        nodeId,
        surfaceKey: scope?.surfaceKey,
        instanceId: id,
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

    if (scope)
      assertOccurrencesInScope(
        scope,
        result.map((node) => node.instanceId),
      );

    return result;
  }, [camera, doc, isWorldRectInViewport, nodeWorldBounds, scope, viewport, walkNodes]);

  if (visibleNodes.length === 0) {
    return <div aria-hidden="false" className="sr-only" />;
  }

  return (
    <div aria-hidden="false" className="sr-only">
      <ul aria-label="Canvas objects">
        {visibleNodes.map((node) => (
          <li
            key={node.instanceId}
            data-node-id={node.nodeId}
            data-instance-id={node.instanceId}
            data-surface-key={node.surfaceKey}
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
