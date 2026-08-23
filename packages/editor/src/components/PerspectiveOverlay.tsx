/**
 * React overlay for the PerspectiveTool: four draggable corner handles.
 *
 * Coordinate conversion follows the WarpOverlay pattern:
 *   screen → world (inverse camera rotation + zoom) → node-local (inverse worldMat)
 *
 * The quad lives in node-local [TL, TR, BR, BL] as `[x,y]` tuples.
 * Each drag writes directly to `tool.setCorner()`; committing is handled
 * by useToolManagerSync which calls `tool.commit()`.
 */

import {
  computeFloatingOrigin,
  screenDeltaToWorld,
  worldToScreen as sharedWorldToScreen,
} from '@varve/shared';
import { getEditorViewport } from '../canvas/cameraState';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../context';
import { nodeWorldTransform } from '../scene/world';
import type { PerspectiveState, PerspectiveTool } from '../tools/PerspectiveTool';

interface Props {
  tool: PerspectiveTool;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
}

const HANDLE_R = 6;
const HANDLE_HIT_SIZE = 28;
const LABELS = ['TL', 'TR', 'BR', 'BL'] as const;

function worldToLocal(
  dx: number,
  dy: number,
  worldMat: readonly [number, number, number, number, number, number],
): { x: number; y: number } {
  const [a, b, c, d] = worldMat;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return { x: 0, y: 0 };
  return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det };
}

export function PerspectiveOverlay({ tool, zoom, pan, cameraRotation }: Props) {
  const { state } = useEditor();
  const doc = state.document;
  const ps: PerspectiveState | null = tool.current;
  const [drag, setDrag] = useState<{
    corner: 0 | 1 | 2 | 3;
    startClientX: number;
    startClientY: number;
    startQuad: PerspectiveState['quad'];
  } | null>(null);
  const [, redraw] = useState(0);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  useEffect(() => tool.subscribe(() => redraw((value) => value + 1)), [tool]);

  const worldMat = ps ? nodeWorldTransform(doc, ps.nodeId) : null;

  // ── Coordinate conversion ────────────────────────────────────────────
  const nodeToScreen = useCallback(
    (nx: number, ny: number): { x: number; y: number } | null => {
      if (!worldMat) return null;
      const [a, b, c, d, e, f] = worldMat;
      const wx = a * nx + c * ny + e;
      const wy = b * nx + d * ny + f;
      const viewport = getEditorViewport();
      const camera = { zoom, pan, rotation: cameraRotation };
      const origin = computeFloatingOrigin(camera, viewport);
      const [x, y] = sharedWorldToScreen(
        camera,
        wx,
        wy,
        viewport,
        origin,
      );
      return { x, y };
    },
    [worldMat, zoom, pan, cameraRotation],
  );

  // ── Pointer handlers ─────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (corner: 0 | 1 | 2 | 3) => (e: React.PointerEvent) => {
      if (!ps) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({
        corner,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startQuad: ps.quad,
      });
    },
    [ps],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag || !ps || !worldMat) return;
      const screenDx = e.clientX - drag.startClientX;
      const screenDy = e.clientY - drag.startClientY;
      const [worldDx, worldDy] = screenDeltaToWorld(
        { zoom, pan, rotation: cameraRotation },
        screenDx,
        screenDy,
      );
      const localD = worldToLocal(worldDx, worldDy, worldMat);
      const orig = drag.startQuad[drag.corner];
      tool.setCorner(drag.corner, orig[0] + localD.x, orig[1] + localD.y);
    },
    [drag, ps, worldMat, zoom, cameraRotation, tool],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDrag(null);
    },
    [drag],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDrag(null);
    },
    [],
  );

  // ── Escape cancels ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) {
        e.preventDefault();
        tool.restoreOriginal();
        redraw((value) => value + 1);
        setDrag(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  if (!ps || !worldMat) return null;

  const corners = ps.quad.map((pt, i) => {
    const s = nodeToScreen(pt[0], pt[1]);
    return s ? { ...s, label: LABELS[i]! } : null;
  });

  if (corners.some((c) => !c)) return null;

  return (
    <>
      {/* Quad outline */}
      <svg
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'visible',
          zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX,
        }}
      >
        <polygon
          points={corners.map((c) => `${c!.x},${c!.y}`).join(' ')}
          fill="rgba(128, 128, 255, 0.06)"
          stroke="rgba(128, 128, 255, 0.85)"
          strokeWidth={1.5}
          strokeDasharray="6 3"
        />
      </svg>

      {/* Corner handles */}
      {corners.map((c, i) => (
        <button
          type="button"
          key={c!.label}
          onPointerDown={onPointerDown(i as 0 | 1 | 2 | 3)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onPointerCancel}
          aria-label={`Perspective corner ${c!.label}`}
          style={{
            position: 'absolute',
            left: c!.x - HANDLE_HIT_SIZE / 2,
            top: c!.y - HANDLE_HIT_SIZE / 2,
            width: HANDLE_HIT_SIZE,
            height: HANDLE_HIT_SIZE,
            borderRadius: '50%',
            background: `radial-gradient(circle ${HANDLE_R}px, rgba(128, 128, 255, 0.95) ${HANDLE_R - 1}px, white ${HANDLE_R}px, white ${HANDLE_R + 2}px, transparent ${HANDLE_R + 3}px)`,
            border: 0,
            cursor: 'grab',
            pointerEvents: 'auto',
            zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX + 1,
          }}
        />
      ))}
    </>
  );
}
