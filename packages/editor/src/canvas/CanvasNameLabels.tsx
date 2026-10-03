/**
 * CanvasNameLabels — derived, screen-space names for the resolved editor
 * surface. Membership comes from the same occurrence projection as the
 * renderer; this component never traverses document roots on its own.
 */

import { getFontRegistry } from '@varve/engine';
import {
  assertOccurrencesInScope,
  type Document,
  type NodeId,
  type ResolvedEditorSceneScope,
} from '@varve/scene';
import type { Viewport } from '@varve/shared';
import { useMemo, useRef, useSyncExternalStore } from 'react';
import type { TransformPreviewStore } from '../context/ViewportContext';
import { occurrenceGeometry } from '../scene/occurrenceGeometry';
import { screenRectToWorldRect, worldRectToScreenAabbProjector } from '../scene/world';
import { toCamera } from './cameraState';
import {
  type NameLabelCandidate,
  nameLabelReach,
  pickNameLabelCandidates,
} from './nameLabelPolicy';
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
  transformPreviewStore?: TransformPreviewStore;
}

interface CandidateCache {
  document: Document;
  scope: ResolvedEditorSceneScope;
  revision: string | number;
  candidates: NameLabelCandidate[];
  byInstanceId: Map<string, NameLabelCandidate>;
}

function collectCandidates(
  doc: Document,
  scope: ResolvedEditorSceneScope,
  boundsByInstanceId: ReadonlyMap<string, { x: number; y: number; w: number; h: number } | null>,
): NameLabelCandidate[] {
  const out: NameLabelCandidate[] = [];

  for (const [paintOrder, entry] of scope.occurrences.entries()) {
    const node = doc.nodes[entry.nodeId];
    if (!node) continue;
    const bounds = boundsByInstanceId.get(entry.instanceId) ?? null;
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
      selected: false,
      hovered: false,
      editing: false,
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
  transformPreviewStore,
}: CanvasNameLabelsProps) {
  const transformPreview = useSyncExternalStore(
    transformPreviewStore?.subscribe ?? subscribeToNoTransformPreview,
    transformPreviewStore?.getSnapshot ?? emptyTransformPreview,
    transformPreviewStore?.getSnapshot ?? emptyTransformPreview,
  );
  const previewMatchesDocument = transformPreview?.baseDocument === doc;
  const renderDocument = previewMatchesDocument ? transformPreview.document : doc;
  const candidateCacheRef = useRef<CandidateCache | null>(null);
  // World-space candidates do not depend on the camera. Keeping them out of
  // the projection memo means a pan or zoom frame re-projects and re-picks
  // only, instead of recomputing every occurrence's world bounds.
  // Text bounds follow loaded font metrics; the revision refreshes candidates
  // on the next render after a font load, as camera changes used to.
  const fontRevision = getFontRegistry().revision;
  const baseCandidates = useMemo(() => {
    const geometry = occurrenceGeometry(renderDocument, scope, {
      revision: fontRevision,
      ...(previewMatchesDocument
        ? { transformChangedNodeIds: transformPreview.changedNodeIds }
        : {}),
    });
    const existing = candidateCacheRef.current;
    if (
      previewMatchesDocument &&
      existing?.document === doc &&
      existing.scope === scope &&
      existing.revision === fontRevision
    ) {
      for (const instanceId of geometry.recalculatedInstanceIds) {
        const candidate = existing.byInstanceId.get(instanceId);
        const bounds = geometry.boundsByInstanceId.get(instanceId);
        if (!candidate || !bounds) continue;
        candidate.x = bounds.x;
        candidate.y = bounds.y;
        candidate.w = Math.max(0, bounds.w);
        candidate.h = Math.max(0, bounds.h);
      }
      return existing.candidates;
    }

    const candidates = collectCandidates(renderDocument, scope, geometry.boundsByInstanceId);
    candidateCacheRef.current = {
      document: doc,
      scope,
      revision: fontRevision,
      candidates,
      byInstanceId: new Map(candidates.map((candidate) => [candidate.id, candidate])),
    };
    return candidates;
  }, [doc, fontRevision, previewMatchesDocument, renderDocument, scope, transformPreview]);
  const candidates = useMemo(() => {
    const selectedIds = new Set(selection);
    for (const candidate of baseCandidates) {
      candidate.selected = candidate.nodeId ? selectedIds.has(candidate.nodeId) : false;
      candidate.hovered = hoveredNodeId === candidate.nodeId;
      candidate.editing = editingNodeId === candidate.nodeId;
    }
    // A new array invalidates the priority-order memo only when selection,
    // hover, or text editing changes. Transform previews update candidate
    // coordinates in place and retain this stable ordered view.
    return [...baseCandidates];
  }, [baseCandidates, editingNodeId, hoveredNodeId, selection]);
  const labels = useMemo(() => {
    const camera = toCamera({ zoom, pan, cameraRotation });
    const projectRect = worldRectToScreenAabbProjector(camera, viewport);
    // Unrotated, a world-space reach test rejects the off-screen majority
    // (9,900 of 10,000 nodes at fit-all on a large document) without
    // projecting them on every pan and zoom frame.
    const reach = screenRectToWorldRect(
      nameLabelReach(viewport.width, viewport.height),
      camera,
      viewport,
    );
    const picked = pickNameLabelCandidates(candidates, {
      zoom,
      viewportW: viewport.width,
      viewportH: viewport.height,
      ...(reach
        ? {
            mayBeVisible: (candidate: NameLabelCandidate) =>
              candidate.x <= reach.x + reach.w &&
              candidate.x + candidate.w >= reach.x &&
              candidate.y <= reach.y + reach.h &&
              candidate.y + candidate.h >= reach.y,
          }
        : {}),
      project: (candidate) => {
        const screen = projectRect({
          x: candidate.x,
          y: candidate.y,
          w: candidate.w,
          h: candidate.h,
        });
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
  }, [cameraRotation, candidates, pan, scope, transformPreview?.revision, viewport, zoom]);

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
            x={label.labelX}
            y={label.labelY + 16}
            fill={isFrame ? 'var(--color-text-secondary)' : 'var(--color-text-muted)'}
            fontSize={isFrame ? 11 : 10}
            fontFamily="var(--font-body, system-ui, sans-serif)"
            fontWeight={isFrame ? 600 : 500}
            paintOrder="stroke"
            stroke="var(--color-surface-app, transparent)"
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

const emptyTransformPreview = () => null;
const subscribeToNoTransformPreview = (_listener: () => void) => () => {};
