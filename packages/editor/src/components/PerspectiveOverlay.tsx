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

import { isPerspectiveQuadValid } from '@varve/scene';
import {
  computeFloatingOrigin,
  screenDeltaToWorld,
  worldToScreen as sharedWorldToScreen,
} from '@varve/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getEditorViewport } from '../canvas/cameraState';
import { useEditor } from '../context';
import { nodeWorldTransform } from '../scene/world';
import type { PerspectiveState, PerspectiveTool } from '../tools/PerspectiveTool';
import type { ToolContext } from '../tools/types';

interface Props {
  tool: PerspectiveTool;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  buildToolCtx: (ev: PointerEvent) => ToolContext;
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

export function PerspectiveOverlay({ tool, zoom, pan, cameraRotation, buildToolCtx }: Props) {
  const { state, setTool } = useEditor();
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

  const commit = useCallback(() => {
    const current = tool.current;
    if (!current || !isPerspectiveQuadValid(current.quad)) return;
    tool.commit(buildToolCtx({} as PointerEvent));
    // The overlay can own focus, so its window-level key handler may run
    // without the canvas key pipeline. Keep confirmation deterministic by
    // explicitly leaving the modal tool after a valid commit.
    setTool('select');
  }, [buildToolCtx, setTool, tool]);

  const cancel = useCallback(() => {
    tool.cancel(buildToolCtx({} as PointerEvent));
    setTool('select');
  }, [buildToolCtx, setTool, tool]);

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
      const [x, y] = sharedWorldToScreen(camera, wx, wy, viewport, origin);
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

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDrag(null);
  }, []);

  // ── Keyboard completion/cancellation ─────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (dragRef.current) {
          tool.restoreOriginal();
          redraw((value) => value + 1);
          setDrag(null);
        } else {
          cancel();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel, commit, tool]);

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
          zIndex: 'var(--z-overlay)',
        }}
      >
        <polygon
          points={corners.map((c) => `${c!.x},${c!.y}`).join(' ')}
          fill="color-mix(in oklch, var(--color-accent-primary) 6%, transparent)"
          stroke="color-mix(in oklch, var(--color-accent-primary) 85%, transparent)"
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          aria-label={`Perspective corner ${c!.label}`}
          style={{
            position: 'absolute',
            left: c!.x - HANDLE_HIT_SIZE / 2,
            top: c!.y - HANDLE_HIT_SIZE / 2,
            width: HANDLE_HIT_SIZE,
            height: HANDLE_HIT_SIZE,
            borderRadius: '50%',
            background: `radial-gradient(circle ${HANDLE_R}px, color-mix(in oklch, var(--color-accent-primary) 95%, transparent) ${HANDLE_R - 1}px, var(--color-surface-raised) ${HANDLE_R}px, var(--color-surface-raised) ${HANDLE_R + 2}px, transparent ${HANDLE_R + 3}px)`,
            border: 0,
            cursor: 'grab',
            pointerEvents: 'auto',
            // Stay above the selection quick bar while editing. The top
            // corners can otherwise be visually present but pointer-inert
            // beneath that contextual toolbar.
            zIndex: 'var(--z-overlay)',
          }}
        />
      ))}

      <div
        role="toolbar"
        aria-label="Perspective editing actions"
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          gap: 'var(--space-3)',
          padding: 'var(--space-1)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--elevation-surface-raised)',
          boxShadow: 'var(--shadow-md)',
          pointerEvents: 'auto',
          zIndex: 'var(--z-overlay)',
        }}
      >
        <button
          type="button"
          className="varve-btn varve-btn--primary varve-btn--sm"
          onClick={commit}
          aria-label="Apply perspective"
        >
          Apply
        </button>
        <button
          type="button"
          className="varve-btn varve-btn--ghost varve-btn--sm"
          onClick={cancel}
          aria-label="Cancel perspective"
        >
          Cancel
        </button>
      </div>
    </>
  );
}
