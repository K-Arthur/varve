/**
 * CanvasNameLabels — Figma-style name tags above frames / nodes when zoomed out.
 *
 * Screen-space SVG sibling of the canvas; uses the same floating-origin camera
 * math as MeasureOverlay so labels stay glued to painted geometry.
 *
 * Research basis: Figma frame/section titles at low zoom.
 */
import { type Document, getParent, isContainer, type NodeId } from '@strata/scene';
import { useMemo } from 'react';
import { nodeWorldBounds } from '../scene/world';
import { editorWorldToScreen, getEditorViewport } from './cameraState';
import { type NameLabelCandidate, pickNameLabelCandidates } from './canvasNameLabels';

export interface CanvasNameLabelsProps {
  doc: Document;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  selection: NodeId[];
}

function collectCandidates(doc: Document): NameLabelCandidate[] {
  const out: NameLabelCandidate[] = [];
  const visit = (id: NodeId, depth: number) => {
    const node = doc.nodes[id];
    if (!node || node.hidden) return;
    const bounds = nodeWorldBounds(doc, id);
    if (!bounds) return;
    const parent = getParent(doc, id);
    out.push({
      id,
      name: node.name,
      kind: node.kind,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      depth,
      parentId: parent?.id ?? null,
    });
    if (isContainer(node)) {
      for (const childId of node.children) visit(childId, depth + 1);
    }
  };
  for (const id of doc.rootChildren) visit(id, 0);
  return out;
}

export function CanvasNameLabels({ doc, zoom, pan, cameraRotation }: CanvasNameLabelsProps) {
  const viewport = getEditorViewport();
  const camState = useMemo(() => ({ zoom, pan, cameraRotation }), [zoom, pan, cameraRotation]);

  const labels = useMemo(() => {
    const candidates = collectCandidates(doc);
    return pickNameLabelCandidates(candidates, {
      zoom,
      viewportW: viewport.width,
      viewportH: viewport.height,
      project: (c) => {
        const [sx, sy] = editorWorldToScreen(camState, c.x, c.y, viewport);
        return {
          screenX: sx,
          screenY: sy,
          screenW: c.w * zoom,
          screenH: c.h * zoom,
        };
      },
    });
  }, [doc, zoom, camState, viewport.width, viewport.height]);

  if (labels.length === 0) return null;

  return (
    <svg
      role="presentation"
      aria-hidden
      className="canvas-name-labels"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 3,
      }}
    >
      {labels.map((lab) => {
        const isFrame = lab.kind === 'frame';
        return (
          <text
            key={lab.id}
            x={lab.screenX}
            y={lab.screenY - 6}
            fill={isFrame ? 'var(--color-text-secondary)' : 'var(--color-text-muted)'}
            fontSize={isFrame ? 11 : 10}
            fontFamily="var(--font-body, system-ui, sans-serif)"
            fontWeight={isFrame ? 600 : 500}
          >
            {lab.name}
          </text>
        );
      })}
    </svg>
  );
}
