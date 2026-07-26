import { useMemo } from 'react';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../../canvas/overlayZIndex';
import type { MatchResult } from '../../findReplace/types';

interface FindReplaceOverlayProps {
  results: MatchResult[];
  currentIndex: number;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  canvasSize: { width: number; height: number };
  getWorldBounds: (nodeId: string) => { x: number; y: number; w: number; h: number } | null;
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
}

export function FindReplaceOverlay({
  results,
  currentIndex,
  zoom,
  pan: _pan,
  cameraRotation: _cameraRotation,
  canvasSize,
  getWorldBounds,
  worldToCanvas,
}: FindReplaceOverlayProps) {
  const rects = useMemo(() => {
    if (results.length === 0) return [];
    return results
      .map((match, idx) => {
        const worldBounds = getWorldBounds(match.nodeId);
        if (!worldBounds) return null;
        const { x: sx, y: sy } = worldToCanvas(worldBounds.x, worldBounds.y);
        const sw = worldBounds.w * zoom;
        const sh = worldBounds.h * zoom;
        return {
          idx,
          isActive: idx === currentIndex,
          screenRect: { x: sx, y: sy, w: sw, h: sh },
        };
      })
      .filter(Boolean) as {
      idx: number;
      isActive: boolean;
      screenRect: { x: number; y: number; w: number; h: number };
    }[];
  }, [results, currentIndex, zoom, getWorldBounds, worldToCanvas]);

  if (canvasSize.width === 0 || rects.length === 0) return null;

  return (
    <svg
      role="presentation"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        width: '100%',
        height: '100%',
        touchAction: 'none',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX + 1,
      }}
    >
      {rects.map((r) => (
        <rect
          key={r.idx}
          x={r.screenRect.x}
          y={r.screenRect.y}
          width={r.screenRect.w}
          height={r.screenRect.h}
          fill={r.isActive ? 'rgba(8, 145, 178, 0.35)' : 'rgba(251, 191, 36, 0.2)'}
          stroke={r.isActive ? 'rgba(8, 145, 178, 0.8)' : 'rgba(251, 191, 36, 0.5)'}
          strokeWidth={r.isActive ? 2 : 1}
          rx={2}
        />
      ))}
    </svg>
  );
}
