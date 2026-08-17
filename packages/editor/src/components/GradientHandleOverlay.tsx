import type { Document, Fill, GradientFill, NodeId } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { computeFloatingOrigin, screenToWorld, worldToScreen } from '@varve/shared';
import { useCallback, useRef, useState } from 'react';
import { getEditorViewport } from '../canvas/cameraState';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';

interface GradientHandleOverlayProps {
  zoom: number;
  pan: { x: number; y: number };
  selectedIds: NodeId[];
  doc: Document;
  getWorldTransform: (id: NodeId) => Affine | null;
  onUpdateGradient: (nodeId: NodeId, fillIndex: number, gradient: GradientFill) => void;
}

// Must match the transform the canvas actually paints with
// (applyEditorCameraToCtx: floating origin) — naive world*zoom+pan drifts
// from the real paint position once panned away from world (0,0), putting
// these handles somewhere other than the gradient they're meant to control.
function worldToCanvas(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  const cam = { zoom, pan };
  const viewport = getEditorViewport();
  const origin = computeFloatingOrigin(cam, viewport);
  const [x, y] = worldToScreen(cam, wx, wy, viewport, origin);
  return { x, y };
}

interface GradientHandle {
  nodeId: NodeId;
  fillIndex: number;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  halfDiag: number;
  gradient: GradientFill;
  nodeTransform: Affine;
}

function getGradientHandles(
  selectedIds: NodeId[],
  doc: Document,
  getWorldTransform: (id: NodeId) => Affine | null,
): GradientHandle[] {
  const handles: GradientHandle[] = [];
  for (const id of selectedIds) {
    const node = doc.nodes[id];
    if (!node) continue;
    const nodeAny = node as unknown as Record<string, unknown>;
    const fills: Fill[] =
      'fills' in nodeAny && Array.isArray(nodeAny.fills) ? (nodeAny.fills as Fill[]) : [];
    const nodeTransform: Affine =
      getWorldTransform(id) ??
      ('transform' in nodeAny ? (nodeAny.transform as Affine) : [1, 0, 0, 1, 0, 0]);
    let bounds = { x: 0, y: 0, w: 100, h: 100 };
    if (typeof nodeAny.w === 'number' && typeof nodeAny.h === 'number') {
      bounds = {
        x: (nodeAny.x as number) ?? 0,
        y: (nodeAny.y as number) ?? 0,
        w: nodeAny.w as number,
        h: nodeAny.h as number,
      };
    }
    for (let fi = 0; fi < fills.length; fi++) {
      const fill = fills[fi];
      if (!fill?.visible) continue;
      if (fill.type !== 'gradient' || !fill.gradient) continue;
      const g = fill.gradient;
      const cx = bounds.x + bounds.w / 2;
      const cy = bounds.y + bounds.h / 2;
      const halfDiag = Math.sqrt(bounds.w * bounds.w + bounds.h * bounds.h) / 2;
      let rot = ((g.rotation ?? 0) * Math.PI) / 180;
      let useCx = cx;
      let useCy = cy;
      let useHalf = halfDiag;
      if (g.transform) {
        const t = g.transform;
        const du = t[0] * halfDiag;
        const dv = t[1] * halfDiag;
        useCx = bounds.x + t[4];
        useCy = bounds.y + t[5];
        rot = Math.atan2(dv, du);
        useHalf = Math.sqrt(du * du + dv * dv);
      }
      const dx = Math.cos(rot) * useHalf;
      const dy = Math.sin(rot) * useHalf;
      handles.push({
        nodeId: id,
        fillIndex: fi,
        cx: useCx,
        cy: useCy,
        dx,
        dy,
        halfDiag: useHalf,
        gradient: g,
        nodeTransform,
      });
    }
  }
  return handles;
}

function stopColorHex(color: {
  space: string;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  c?: number;
  m?: number;
  y?: number;
  k?: number;
}): string {
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

export function GradientHandleOverlay({
  zoom,
  pan,
  selectedIds,
  doc,
  getWorldTransform,
  onUpdateGradient,
}: GradientHandleOverlayProps) {
  const handles = getGradientHandles(selectedIds, doc, getWorldTransform);
  const [dragging, setDragging] = useState<{ nodeId: NodeId; fillIndex: number } | null>(null);
  const dragRef = useRef<{ startAngle: number; nodeId: NodeId; fillIndex: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, h: GradientHandle) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startAngle = Math.atan2(h.dy, h.dx);
      dragRef.current = { startAngle, nodeId: h.nodeId, fillIndex: h.fillIndex };
      setDragging({ nodeId: h.nodeId, fillIndex: h.fillIndex });
      const onMove = (me: PointerEvent) => {
        if (!dragRef.current) return;
        const rect = (e.currentTarget as HTMLElement).closest('section')?.getBoundingClientRect();
        if (!rect) return;
        const cam = { zoom, pan };
        const viewport = getEditorViewport();
        const origin = computeFloatingOrigin(cam, viewport);
        const [mx, my] = screenToWorld(
          cam,
          me.clientX - rect.left,
          me.clientY - rect.top,
          viewport,
          origin,
        );
        const newAngle = Math.atan2(my - h.cy, mx - h.cx);
        const newDeg = ((newAngle * 180) / Math.PI + 360) % 360;
        const updatedGrad = { ...h.gradient, rotation: Math.round(newDeg) };
        onUpdateGradient(h.nodeId, h.fillIndex, updatedGrad);
      };
      const onUp = () => {
        dragRef.current = null;
        setDragging(null);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [zoom, pan, onUpdateGradient],
  );

  if (handles.length === 0) return null;

  return (
    <svg
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
      {handles.map((h) => {
        const startW = worldToCanvas(h.cx - h.dx, h.cy - h.dy, zoom, pan);
        const endW = worldToCanvas(h.cx + h.dx, h.cy + h.dy, zoom, pan);
        const isDragging = dragging?.nodeId === h.nodeId && dragging?.fillIndex === h.fillIndex;

        return (
          <g key={`gradient-${h.nodeId}-${h.fillIndex}`}>
            {/* Gradient direction line */}
            <line
              x1={startW.x}
              y1={startW.y}
              x2={endW.x}
              y2={endW.y}
              stroke="var(--color-accent-primary, #39d0c6)"
              strokeWidth={2 / Math.max(1, zoom * 0.5)}
              strokeDasharray={`${4 / zoom}, ${4 / zoom}`}
              opacity={0.7}
            />

            {/* Stop markers along gradient line */}
            {h.gradient.stops.map((stop, si) => {
              const t = stop.position;
              const sx = h.cx - h.dx + 2 * t * h.dx;
              const sy = h.cy - h.dy + 2 * t * h.dy;
              const sw = worldToCanvas(sx, sy, zoom, pan);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: gradient stops have no stable id; position/color change while editing (content keys would remount mid-drag)
                <g key={`stop-${si}`}>
                  <circle
                    cx={sw.x}
                    cy={sw.y}
                    r={5 / Math.max(1, zoom * 0.5)}
                    fill={stopColorHex(stop.color)}
                    stroke="#fff"
                    strokeWidth={1.5 / Math.max(1, zoom * 0.5)}
                  />
                  {stop.midpoint !== undefined && stop.midpoint !== 0.5 && (
                    <circle
                      cx={sw.x}
                      cy={sw.y + 10 / Math.max(1, zoom * 0.5)}
                      r={3 / Math.max(1, zoom * 0.5)}
                      fill="var(--color-text-muted)"
                      opacity={0.6}
                    />
                  )}
                </g>
              );
            })}

            {/* Start handle */}
            <circle
              cx={startW.x}
              cy={startW.y}
              r={6 / Math.max(1, zoom * 0.5)}
              fill="var(--elevation-surface-default, #fff)"
              stroke="var(--color-accent-primary, #39d0c6)"
              strokeWidth={2 / Math.max(1, zoom * 0.5)}
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
              onPointerDown={(e) => handlePointerDown(e, h)}
            />

            {/* End handle (draggable) */}
            <circle
              cx={endW.x}
              cy={endW.y}
              r={isDragging ? 8 / Math.max(1, zoom * 0.5) : 6 / Math.max(1, zoom * 0.5)}
              fill="var(--color-accent-primary, #39d0c6)"
              stroke="#fff"
              strokeWidth={2 / Math.max(1, zoom * 0.5)}
              style={{ pointerEvents: 'auto', cursor: isDragging ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => handlePointerDown(e, h)}
            />

            {/* Radial gradient: show radial indicator */}
            {h.gradient.type === 'radial' && (
              <circle
                cx={endW.x}
                cy={endW.y}
                r={h.halfDiag * zoom}
                fill="none"
                stroke="var(--color-accent-primary, #39d0c6)"
                strokeWidth={1 / Math.max(1, zoom * 0.5)}
                strokeDasharray={`${2 / zoom}, ${4 / zoom}`}
                opacity={0.4}
                style={{ pointerEvents: 'none' }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
