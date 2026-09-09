/**
 * CanvasNameLabels — derived, screen-space names for the resolved editor
 * surface. Membership comes from the same occurrence projection as the
 * renderer; this component never traverses document roots on its own.
 */
import {
  assertOccurrencesInScope,
  buildParentIndexMap,
  type Document,
  type NodeId,
  type ResolvedEditorSceneScope,
} from '@varve/scene';
import type { Viewport } from '@varve/shared';
import { useMemo } from 'react';
import { nodeWorldBounds, worldRectToScreenAabb } from '../scene/world';
import { toCamera } from './cameraState';
import { type NameLabelCandidate, pickNameLabelCandidates } from './nameLabelPolicy';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from './overlayZIndex';

export interface CanvasNameLabelsProps {
  doc: Document;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  selection: readonly NodeId[];
  scope: ResolvedEditorSceneScope;
  viewport: Viewport;
  hoveredNodeId?: NodeId | null;
  editingNodeId?: NodeId | null;
}

function offsetBounds(
  bounds: { x: number; y: number; w: number; h: number },
  offset: { x: number; y: number },
) {
  return { ...bounds, x: bounds.x + offset.x, y: bounds.y + offset.y };
}

function collectCandidates(
  doc: Document,
  scope: ResolvedEditorSceneScope,
  selection: readonly NodeId[],
  hoveredNodeId: NodeId | null | undefined,
  editingNodeId: NodeId | null | undefined,
): NameLabelCandidate[] {
  const selectedIds = new Set(selection);
  const parents = buildParentIndexMap(doc);
  const out: NameLabelCandidate[] = [];

  for (const [paintOrder, entry] of scope.occurrences.entries()) {
    const node = doc.nodes[entry.nodeId];
    if (!node) continue;
    let bounds = nodeWorldBounds(doc, entry.nodeId, parents);
    if (bounds && entry.masterPlacement) bounds = offsetBounds(bounds, entry.masterPlacement);
    if (!bounds || ![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)) continue;
    out.push({
      id: entry.instanceId,
      nodeId: entry.nodeId,
      name: node.name ?? '',
      kind: node.kind,
      x: bounds.x,
      y: bounds.y,
      w: Math.max(0, bounds.w),
      h: Math.max(0, bounds.h),
      depth: entry.depth,
      parentId: entry.parentId,
      surfaceKey: scope.surfaceKey,
      selected: selectedIds.has(entry.nodeId),
      hovered: hoveredNodeId === entry.nodeId,
      editing: editingNodeId === entry.nodeId,
      paintOrder,
    });
  }
  return out;
}

export function CanvasNameLabels({
  doc,
  zoom,
  pan,
  cameraRotation,
  selection,
  scope,
  viewport,
  hoveredNodeId = null,
  editingNodeId = null,
}: CanvasNameLabelsProps) {
  const labels = useMemo(() => {
    const camera = toCamera({ zoom, pan, cameraRotation });
    const candidates = collectCandidates(doc, scope, selection, hoveredNodeId, editingNodeId);
    const picked = pickNameLabelCandidates(candidates, {
      zoom,
      viewportW: viewport.width,
      viewportH: viewport.height,
      project: (candidate) => {
        const screen = worldRectToScreenAabb(
          { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h },
          camera,
          viewport,
        );
        return {
          screenX: screen.x,
          screenY: screen.y,
          screenW: screen.w,
          screenH: screen.h,
        };
      },
    });
    assertOccurrencesInScope(
      scope,
      picked.map((label) => label.id),
    );
    return picked;
  }, [cameraRotation, doc, editingNodeId, hoveredNodeId, pan, scope, selection, viewport, zoom]);

  if (labels.length === 0) return null;

  return (
    <svg
      role="presentation"
      aria-hidden="true"
      className="canvas-name-labels"
      data-surface-key={scope.surfaceKey}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX,
      }}
    >
      {labels.map((label) => {
        const isFrame = label.kind === 'frame';
        return (
          <text
            key={label.id}
            x={label.screenX}
            y={label.screenY - 6}
            fill={isFrame ? 'var(--color-text-secondary)' : 'var(--color-text-muted)'}
            fontSize={isFrame ? 11 : 10}
            fontFamily="var(--font-body, system-ui, sans-serif)"
            fontWeight={isFrame ? 600 : 500}
            paintOrder="stroke"
            stroke="var(--color-surface-canvas, transparent)"
            strokeWidth={2}
            data-node-id={label.nodeId}
            data-instance-id={label.id}
            data-surface-key={scope.surfaceKey}
            data-label-kind={isFrame ? 'frame' : 'object'}
            data-selected={label.selected ? 'true' : undefined}
          >
            <title>{label.fullName}</title>
            {label.displayName}
          </text>
        );
      })}
    </svg>
  );
}
