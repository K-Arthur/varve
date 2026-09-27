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

import { getFontRegistry } from '@varve/engine';
import type {
  Document,
  MultipageNodeInstance,
  NodeId,
  ResolvedEditorSceneScope,
} from '@varve/scene';
import { assertOccurrencesInScope } from '@varve/scene';
import { useDeferredValue, useMemo } from 'react';
import { occurrenceGeometry } from '../scene/occurrenceGeometry';
import { committedParentIndex } from '../scene/parentIndexCache';

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
  /**
   * Optional tester factory with the same answers as `isWorldRectInViewport`,
   * built once per camera so a frame does not rebuild the camera affine per
   * node.
   */
  createViewportTest?: (
    cam: { zoom: number; pan: { x: number; y: number }; rotation?: number },
    vp: { width: number; height: number },
  ) => (rect: { x: number; y: number; w: number; h: number }) => boolean;
}

export function CanvasAccessibilityTree({
  doc,
  camera,
  viewport,
  scope,
  walkNodes,
  nodeWorldBounds,
  isWorldRectInViewport,
  createViewportTest,
}: CanvasAccessibilityTreeProps) {
  // World bounds do not depend on the camera: computing them once per
  // document keeps pans and zooms (and every unrelated overlay re-render,
  // which used to pass a fresh camera object) from walking every occurrence's
  // transform chain again.
  // Deferred: this list is for screen readers, not pixels. During a drag
  // every frame is a new document, and walking every occurrence's transform
  // chain per frame competed with the canvas. React renders it after the
  // urgent frame and drops the work when the next input arrives; the list
  // always converges on the current document.
  const currentProjection = useMemo(() => ({ doc, scope }), [doc, scope]);
  const deferredProjection = useDeferredValue(currentProjection);
  const deferredDoc = deferredProjection.doc;
  const deferredScope = deferredProjection.scope;
  const fontRevision = getFontRegistry().revision;
  const worldNodes = useMemo(() => {
    const doc = deferredDoc;
    const scope = deferredScope;
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
    const geometry = scope
      ? occurrenceGeometry(doc, scope, { revision: fontRevision, boundsForNode: nodeWorldBounds })
      : null;
    const parentIndex = scope ? undefined : committedParentIndex(doc);
    const result: Array<{
      id: string;
      nodeId: string;
      surfaceKey?: string;
      instanceId: string;
      name: string;
      kind: string;
      depth: number;
      bounds: { x: number; y: number; w: number; h: number };
      backgroundRemoved: boolean;
      bgRemovalMethod?: string;
    }> = [];

    for (const [id, info] of entries) {
      const occurrence = 'entry' in info ? info.entry : undefined;
      const nodeId = info.nodeId;
      const n = doc.nodes[nodeId];
      if (!n || n.visible === false) continue;
      const bounds = occurrence
        ? (geometry?.boundsByInstanceId.get(id) ?? null)
        : nodeWorldBounds(doc, nodeId, parentIndex);
      if (!bounds) continue;
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
        bounds,
        backgroundRemoved: bgRemoval != null,
        bgRemovalMethod: bgRemoval?.method,
      });
    }
    return result;
  }, [deferredDoc, deferredScope, fontRevision, nodeWorldBounds, walkNodes]);

  const { zoom, rotation } = camera;
  const { x: panX, y: panY } = camera.pan;
  const { width: viewportW, height: viewportH } = viewport;
  const visibleNodes = useMemo(() => {
    const cam = { zoom, pan: { x: panX, y: panY }, rotation };
    const vp = { width: viewportW, height: viewportH };
    const inViewport = createViewportTest
      ? createViewportTest(cam, vp)
      : (rect: { x: number; y: number; w: number; h: number }) =>
          isWorldRectInViewport(cam, vp, rect);
    const result = [];
    for (const { bounds, ...node } of worldNodes) {
      if (!inViewport(bounds)) continue;
      result.push({
        ...node,
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        w: Math.round(bounds.w),
        h: Math.round(bounds.h),
      });
    }

    if (deferredScope)
      assertOccurrencesInScope(
        deferredScope,
        result.map((node) => node.instanceId),
      );

    return result;
  }, [
    createViewportTest,
    isWorldRectInViewport,
    panX,
    panY,
    rotation,
    deferredScope,
    viewportH,
    viewportW,
    worldNodes,
    zoom,
  ]);

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
