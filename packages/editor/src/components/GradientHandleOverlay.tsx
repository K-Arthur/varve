/** Canvas controls for direct manipulation of a gradient's affine fill field. */

import type { Document, Fill, GradientFill, NodeId } from '@varve/scene';
import { nodeLocalBounds } from '@varve/scene';
import type { Affine, Point, Rect } from '@varve/shared';
import {
  applyAffine,
  computeFloatingOrigin,
  linearGradientHandles,
  radialGradientHandles,
  screenToWorld,
  tryInvertAffine,
  worldToScreen,
} from '@varve/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getEditorViewport } from '../canvas/cameraState';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';
import { type GradientHandleKind, moveGradientHandle } from './gradientHandleGeometry';

interface GradientHandleOverlayProps {
  zoom: number;
  pan: { x: number; y: number };
  selectedIds: NodeId[];
  doc: Document;
  getWorldTransform: (id: NodeId) => Affine | null;
  onUpdateGradient: (nodeId: NodeId, fillIndex: number, gradient: GradientFill) => void;
  /** Kept separate so the caller can make the full drag a single undo entry. */
  onEditStart?: () => void;
  onEditEnd?: () => void;
  onEditCancel?: () => void;
}

interface GradientHandle {
  nodeId: NodeId;
  fillIndex: number;
  gradient: GradientFill;
  bounds: Rect;
  nodeTransform: Affine;
  linear?: { start: Point; end: Point };
  radial?: { center: Point; uAxisEnd: Point; vAxisEnd: Point };
}

interface DragSession {
  pointerId: number;
  handle: GradientHandle;
  kind: GradientHandleKind;
  svg: SVGSVGElement;
}

// Must match the floating-origin camera transform used by CanvasArea. The SVG
// sits in canvas CSS pixels, while fill handles begin as document world points.
function worldToCanvas(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  const camera = { zoom, pan };
  const viewport = getEditorViewport();
  const origin = computeFloatingOrigin(camera, viewport);
  const [x, y] = worldToScreen(camera, wx, wy, viewport, origin);
  return { x, y };
}

function getGradientHandles(
  selectedIds: NodeId[],
  doc: Document,
  getWorldTransform: (id: NodeId) => Affine | null,
): GradientHandle[] {
  // A shared fill-index callback cannot safely edit a mixed multi-selection.
  // Keep direct manipulation precise until multi-node gradient editing has a
  // deliberate linked/unlinked contract.
  if (selectedIds.length !== 1) return [];

  const id = selectedIds[0];
  const node = doc.nodes[id];
  if (!node) return [];
  const bounds = nodeLocalBounds(node, doc);
  if (!bounds || bounds.w === 0 || bounds.h === 0) return [];
  const nodeAny = node as unknown as { fills?: Fill[]; transform?: Affine };
  const fills = nodeAny.fills ?? [];
  const nodeTransform = getWorldTransform(id) ?? nodeAny.transform ?? [1, 0, 0, 1, 0, 0];

  return fills.flatMap((fill, fillIndex) => {
    if (!fill.visible || fill.type !== 'gradient' || !fill.gradient) return [];
    const gradient = fill.gradient;
    return [
      {
        nodeId: id,
        fillIndex,
        gradient,
        bounds,
        nodeTransform,
        ...(gradient.type === 'radial'
          ? { radial: radialGradientHandles(gradient, bounds) }
          : { linear: linearGradientHandles(gradient, bounds) }),
      },
    ];
  });
}

function stopColorHex(color: { space: string; r?: number; g?: number; b?: number }): string {
  if (
    color.space === 'rgb' &&
    color.r !== undefined &&
    color.g !== undefined &&
    color.b !== undefined
  ) {
    return `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;
  }
  return '#888';
}

function localToCanvas(
  point: Point,
  nodeTransform: Affine,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  const [worldX, worldY] = applyAffine(nodeTransform, point);
  return worldToCanvas(worldX, worldY, zoom, pan);
}

function HandleCircle({
  point,
  fill,
  active,
  handleKind,
  fillIndex,
  onPointerDown,
}: {
  point: { x: number; y: number };
  fill: string;
  active: boolean;
  handleKind: GradientHandleKind;
  fillIndex: number;
  onPointerDown: (event: React.PointerEvent<SVGCircleElement>) => void;
}) {
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={active ? 8 : 6}
      fill={fill}
      stroke="#fff"
      strokeWidth={2}
      data-gradient-handle={handleKind}
      data-gradient-fill-index={fillIndex}
      style={{ pointerEvents: 'auto', cursor: active ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
    />
  );
}

export function GradientHandleOverlay({
  zoom,
  pan,
  selectedIds,
  doc,
  getWorldTransform,
  onUpdateGradient,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: GradientHandleOverlayProps) {
  const handles = getGradientHandles(selectedIds, doc, getWorldTransform);
  const [dragging, setDragging] = useState<{
    nodeId: NodeId;
    fillIndex: number;
    kind: GradientHandleKind;
  } | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const finishDrag = useCallback(
    (outcome: 'commit' | 'cancel') => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      dragRef.current = null;
      setDragging(null);
      if (outcome === 'commit') onEditEnd?.();
      else onEditCancel?.();
    },
    [onEditCancel, onEditEnd],
  );

  useEffect(
    () => () => {
      if (dragRef.current) finishDrag('cancel');
    },
    [finishDrag],
  );

  const handlePointerDown = useCallback(
    (
      event: React.PointerEvent<SVGCircleElement>,
      handle: GradientHandle,
      kind: GradientHandleKind,
    ) => {
      if (event.button !== 0 || dragRef.current) return;
      const svg = event.currentTarget.ownerSVGElement;
      if (!svg) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      const session: DragSession = { pointerId: event.pointerId, handle, kind, svg };
      dragRef.current = session;
      setDragging({ nodeId: handle.nodeId, fillIndex: handle.fillIndex, kind });
      onEditStart?.();

      const onMove = (moveEvent: PointerEvent) => {
        const active = dragRef.current;
        if (!active || moveEvent.pointerId !== active.pointerId) return;
        const rect = active.svg.getBoundingClientRect();
        const camera = { zoom, pan };
        const viewport = getEditorViewport();
        const origin = computeFloatingOrigin(camera, viewport);
        const [worldX, worldY] = screenToWorld(
          camera,
          moveEvent.clientX - rect.left,
          moveEvent.clientY - rect.top,
          viewport,
          origin,
        );
        const inverse = tryInvertAffine(active.handle.nodeTransform);
        if (!inverse) return;
        const localPoint = applyAffine(inverse, [worldX, worldY]);
        onUpdateGradient(
          active.handle.nodeId,
          active.handle.fillIndex,
          moveGradientHandle(active.handle.gradient, active.handle.bounds, active.kind, localPoint),
        );
      };
      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId === session.pointerId) finishDrag('commit');
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === session.pointerId) finishDrag('cancel');
      };
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [finishDrag, onEditStart, onUpdateGradient, pan, zoom],
  );

  if (handles.length === 0) return null;

  return (
    <svg
      data-gradient-handle-overlay
      data-gradient-dragging={dragging ? 'true' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX,
      }}
      aria-hidden
    >
      <title>Gradient handles</title>
      {handles.map((handle) => {
        const isDragging = (kind: GradientHandleKind) =>
          dragging?.nodeId === handle.nodeId &&
          dragging.fillIndex === handle.fillIndex &&
          dragging.kind === kind;
        const points = handle.radial ?? handle.linear;
        if (!points) return null;
        const start = handle.radial ? points.center : points.start;
        const primary = handle.radial ? points.uAxisEnd : points.end;
        const secondary = handle.radial?.vAxisEnd;
        const startCanvas = localToCanvas(start, handle.nodeTransform, zoom, pan);
        const primaryCanvas = localToCanvas(primary, handle.nodeTransform, zoom, pan);
        const secondaryCanvas =
          secondary && localToCanvas(secondary, handle.nodeTransform, zoom, pan);
        const startKind: GradientHandleKind = handle.radial ? 'radial-center' : 'linear-start';
        const primaryKind: GradientHandleKind = handle.radial ? 'radial-u-axis' : 'linear-end';

        return (
          <g key={`gradient-${handle.nodeId}-${handle.fillIndex}`}>
            <line
              x1={startCanvas.x}
              y1={startCanvas.y}
              x2={primaryCanvas.x}
              y2={primaryCanvas.y}
              stroke="var(--color-accent-primary, #39d0c6)"
              strokeWidth={2}
              strokeDasharray="4 4"
              opacity={0.7}
            />
            {secondaryCanvas && (
              <line
                x1={startCanvas.x}
                y1={startCanvas.y}
                x2={secondaryCanvas.x}
                y2={secondaryCanvas.y}
                stroke="var(--color-accent-primary, #39d0c6)"
                strokeWidth={2}
                strokeDasharray="4 4"
                opacity={0.45}
              />
            )}
            {handle.gradient.stops.map((stop) => {
              const localStop: Point = [
                start[0] + (primary[0] - start[0]) * stop.position,
                start[1] + (primary[1] - start[1]) * stop.position,
              ];
              const canvasStop = localToCanvas(localStop, handle.nodeTransform, zoom, pan);
              return (
                <circle
                  key={`stop-${stop.position}-${stopColorHex(stop.color)}`}
                  cx={canvasStop.x}
                  cy={canvasStop.y}
                  r={5}
                  fill={stopColorHex(stop.color)}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              );
            })}
            <HandleCircle
              point={startCanvas}
              fill="var(--elevation-surface-default, #fff)"
              active={isDragging(startKind)}
              handleKind={startKind}
              fillIndex={handle.fillIndex}
              onPointerDown={(event) => handlePointerDown(event, handle, startKind)}
            />
            <HandleCircle
              point={primaryCanvas}
              fill="var(--color-accent-primary, #39d0c6)"
              active={isDragging(primaryKind)}
              handleKind={primaryKind}
              fillIndex={handle.fillIndex}
              onPointerDown={(event) => handlePointerDown(event, handle, primaryKind)}
            />
            {secondaryCanvas && (
              <HandleCircle
                point={secondaryCanvas}
                fill="var(--color-accent-primary, #39d0c6)"
                active={isDragging('radial-v-axis')}
                handleKind="radial-v-axis"
                fillIndex={handle.fillIndex}
                onPointerDown={(event) => handlePointerDown(event, handle, 'radial-v-axis')}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
