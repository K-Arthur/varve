import { useCallback, useRef, useState } from 'react';
import type { Affine } from '@strata/shared';
import type { Document, Fill, GradientFill, NodeId } from '@strata/scene';

interface GradientHandleOverlayProps {
  zoom: number;
  pan: { x: number; y: number };
  selectedIds: NodeId[];
  doc: Document;
  getWorldTransform: (id: NodeId) => Affine | null;
  onUpdateGradient: (nodeId: NodeId, fillIndex: number, gradient: GradientFill) => void;
}

function worldToCanvas(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  return { x: wx * zoom + pan.x, y: wy * zoom + pan.y };
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
      if (!fill || !fill.visible) continue;
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
        const mx = (me.clientX - rect.left - pan.x) / zoom;
        const my = (me.clientY - rect.top - pan.y) / zoom;
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
      }}
      aria-hidden
    >
      <title>Gradient handles</title>
      {handles.map((h, hi) => {
        const startW = worldToCanvas(h.cx - h.dx, h.cy - h.dy, zoom, pan);
        const endW = worldToCanvas(h.cx + h.dx, h.cy + h.dy, zoom, pan);
        const isDragging = dragging?.nodeId === h.nodeId && dragging?.fillIndex === h.fillIndex;

        return (
          <g key={`gradient-${h.nodeId}-${hi}`}>
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
                      fill="var(--color-accent-secondary, #666)"
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
              fill="var(--color-bg-default, #fff)"
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
