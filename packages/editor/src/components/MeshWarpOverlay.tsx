import type { MeshWarp } from '@strata/engine';
import { useCallback, useRef, useState } from 'react';

interface MeshWarpOverlayProps {
  zoom: number;
  pan: { x: number; y: number };
  mesh: MeshWarp;
  srcW: number;
  srcH: number;
  onMeshChange: (mesh: MeshWarp) => void;
  /** Called once at the start of a drag gesture for undo batching. */
  onDragStart?: () => void;
  /** Called when a drag gesture completes. */
  onDragEnd?: () => void;
  /** Camera rotation in degrees (default 0). */
  cameraRotation?: number;
}

function worldToScreen(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
  rotation: number,
): { x: number; y: number } {
  if (rotation !== 0) {
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = wx * cos - wy * sin;
    const ry = wx * sin + wy * cos;
    return { x: rx * zoom + pan.x, y: ry * zoom + pan.y };
  }
  return { x: wx * zoom + pan.x, y: wy * zoom + pan.y };
}

function screenToWorld(
  sx: number,
  sy: number,
  zoom: number,
  pan: { x: number; y: number },
  rotation: number,
): { x: number; y: number } {
  const ux = (sx - pan.x) / zoom;
  const uy = (sy - pan.y) / zoom;
  if (rotation !== 0) {
    const rad = (-rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { x: ux * cos - uy * sin, y: ux * sin + uy * cos };
  }
  return { x: ux, y: uy };
}

export function MeshWarpOverlay({
  zoom,
  pan,
  mesh,
  srcW,
  srcH,
  onMeshChange,
  onDragStart,
  onDragEnd,
  cameraRotation = 0,
}: MeshWarpOverlayProps) {
  const dragRef = useRef<{
    vertexIndex: number;
    startX: number;
    startY: number;
    vertexStartX: number;
    vertexStartY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleRadius = Math.max(5, 6 / Math.max(1, zoom * 0.5));
  const lineWidth = Math.max(1, 1.5 / Math.max(1, zoom * 0.5));

  const onPointerDown = useCallback(
    (e: React.PointerEvent, vertexIndex: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const vertex = mesh.vertices[vertexIndex];
      if (!vertex) return;

      const { x: sx, y: sy } = worldToScreen(vertex.x, vertex.y, zoom, pan, cameraRotation);

      dragRef.current = {
        vertexIndex,
        startX: e.clientX,
        startY: e.clientY,
        vertexStartX: sx,
        vertexStartY: sy,
      };
      setDragging(true);
      onDragStart?.();

      const onMove = (me: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;

        const dx = me.clientX - d.startX;
        const dy = me.clientY - d.startY;

        const newScreenX = d.vertexStartX + dx;
        const newScreenY = d.vertexStartY + dy;

        const world = screenToWorld(newScreenX, newScreenY, zoom, pan, cameraRotation);
        const clamped = {
          x: Math.max(0, Math.min(srcW, world.x)),
          y: Math.max(0, Math.min(srcH, world.y)),
        };

        const newVertices = [...mesh.vertices];
        newVertices[d.vertexIndex] = clamped;
        onMeshChange({ ...mesh, vertices: newVertices });
      };

      const onUp = () => {
        dragRef.current = null;
        setDragging(false);
        onDragEnd?.();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [mesh, zoom, pan, cameraRotation, srcW, srcH, onMeshChange, onDragStart, onDragEnd],
  );

  const rows = mesh.rows;
  const cols = mesh.cols;

  const gridLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = mesh.vertices[r * (cols + 1) + c]!;
      const b = mesh.vertices[r * (cols + 1) + c + 1]!;
      gridLines.push({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
      });
    }
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) {
      const a = mesh.vertices[r * (cols + 1) + c]!;
      const b = mesh.vertices[(r + 1) * (cols + 1) + c]!;
      gridLines.push({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
      });
    }
  }

  const accentColor = 'var(--color-accent-primary, #39d0c6)';

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label="Mesh warp grid overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'auto',
        zIndex: 10,
        overflow: 'visible',
      }}
    >
      <title>Mesh warp grid overlay</title>
      {gridLines.map((line) => {
        const s1 = worldToScreen(line.x1, line.y1, zoom, pan, cameraRotation);
        const s2 = worldToScreen(line.x2, line.y2, zoom, pan, cameraRotation);
        return (
          <line
            key={`gl-${line.x1.toFixed(1)}-${line.y1.toFixed(1)}-${line.x2.toFixed(1)}-${line.y2.toFixed(1)}`}
            x1={s1.x}
            y1={s1.y}
            x2={s2.x}
            y2={s2.y}
            stroke={accentColor}
            strokeWidth={lineWidth}
            opacity={0.6}
          />
        );
      })}
      {mesh.vertices.map((vertex, vi) => {
        const s = worldToScreen(vertex.x, vertex.y, zoom, pan, cameraRotation);
        return (
          <circle
            key={`vp-${vertex.x.toFixed(1)}-${vertex.y.toFixed(1)}`}
            cx={s.x}
            cy={s.y}
            r={handleRadius}
            fill={dragging && dragRef.current?.vertexIndex === vi ? '#39d0c6' : '#ffffff'}
            stroke={accentColor}
            strokeWidth={lineWidth}
            style={{ cursor: dragging ? 'grabbing' : 'grab' }}
            onPointerDown={(e) => onPointerDown(e, vi)}
          />
        );
      })}
    </svg>
  );
}
