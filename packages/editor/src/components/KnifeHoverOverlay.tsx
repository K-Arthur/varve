/**
 * KnifeHoverOverlay — what the knife is about to cut, before it cuts it.
 *
 * The knife is the one tool whose result is invisible until it has already
 * happened: nothing about a shape says whether it will divide. This traces the
 * outline under the pointer in the tool's own colour when it can be cut, and in
 * a muted dashed outline when it cannot, so an unsupported target reads as
 * "not this one" rather than as a dead tool.
 *
 * Eligibility comes from `knifeRejectionFor`, the same rules the commit runs,
 * so the highlight cannot promise a cut the operation would then refuse.
 *
 * The outline is the node's real flattened geometry, projected corner by corner
 * through its world transform — not a bounding box, which would sit visibly
 * away from a rotated or curved edge.
 *
 * Research basis: Illustrator/Affinity knife hover affordances.
 */
import { type Document, type SceneNode, shapeToPolygon } from '@varve/scene';
import { useMemo } from 'react';
import { editorWorldToScreen, getEditorViewport } from '../canvas/cameraState';
import { knifeRejectionFor } from '../context/sceneNodeGeometry';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';

export interface KnifeHoverOverlayProps {
  doc: Document;
  hoveredNode: SceneNode | null;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
}

export function KnifeHoverOverlay({
  doc,
  hoveredNode,
  zoom,
  pan,
  cameraRotation,
}: KnifeHoverOverlayProps) {
  const viewport = getEditorViewport();

  const outline = useMemo(() => {
    if (!hoveredNode) return null;
    const node = doc.nodes[hoveredNode.id];
    if (!node || node.visible === false || node.locked) return null;

    const camState = { zoom, pan, cameraRotation };
    const world = nodeWorldTransform(doc, node.id);
    const points: Array<[number, number]> =
      node.kind === 'shape'
        ? shapeToPolygon(node.shape, world).map((point) => [point.x, point.y])
        : (() => {
            // Text and other non-shape nodes have no flattened outline to
            // trace; their bounds are enough to say "this one, and no".
            const bounds = nodeWorldBounds(doc, node.id);
            if (!bounds) return [];
            return [
              [bounds.x, bounds.y],
              [bounds.x + bounds.w, bounds.y],
              [bounds.x + bounds.w, bounds.y + bounds.h],
              [bounds.x, bounds.y + bounds.h],
            ];
          })();
    if (points.length < 2) return null;

    const screen = points.map(([wx, wy]) => editorWorldToScreen(camState, wx, wy, viewport));
    if (screen.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;

    return {
      points: screen.map(([x, y]) => `${x},${y}`).join(' '),
      eligible: knifeRejectionFor(node) === null,
    };
  }, [doc, hoveredNode, zoom, pan, cameraRotation, viewport.width, viewport.height]);

  if (!outline) return null;

  return (
    <svg
      role="presentation"
      aria-hidden
      className="knife-hover-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 4,
      }}
    >
      <polygon
        points={outline.points}
        fill="none"
        stroke={
          outline.eligible ? 'var(--color-accent, #2f6f62)' : 'var(--color-text-muted, #8a8a8a)'
        }
        strokeWidth={outline.eligible ? 2 : 1}
        strokeDasharray={outline.eligible ? undefined : '4 4'}
      />
    </svg>
  );
}
