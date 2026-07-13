import type { Guide } from '@strata/scene';
import { useCallback, useRef, useState } from 'react';
import { getEditorViewport } from '../../canvas/cameraState';
import {
  distanceSqToGuideLine,
  guideLineScreenEndpoints,
  screenToGuidePosition,
} from '../../canvas/guideGeometry';
import { GuideContextMenu } from './GuideContextMenu';
import './GuideOverlay.css';

interface GuideOverlayProps {
  guides: Guide[];
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation?: number;
  visible?: boolean;
  selectedGuideId?: string | null;
  onMoveGuide: (id: string, position: number) => void;
  onRemoveGuide: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDuplicateGuide?: (id: string, position: number) => string;
  onSelectGuide?: (id: string | null) => void;
}

const GUIDE_HIT = 8;

export function GuideOverlay({
  guides,
  zoom,
  pan,
  cameraRotation = 0,
  visible = true,
  selectedGuideId = null,
  onMoveGuide,
  onRemoveGuide,
  onToggleLock,
  onDuplicateGuide,
  onSelectGuide,
}: GuideOverlayProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    guideId: string;
  } | null>(null);
  const draggingRef = useRef<string | null>(null);
  const altDuplicateRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const camState = { zoom, pan, cameraRotation };

  const lineForGuide = useCallback(
    (guide: Guide) => {
      const viewport = getEditorViewport();
      return guideLineScreenEndpoints(
        { axis: guide.axis, position: guide.position },
        camState,
        viewport,
      );
    },
    [zoom, pan.x, pan.y, cameraRotation],
  );

  const handlePointerDown = useCallback(
    (guide: Guide, e: React.PointerEvent) => {
      if (e.button === 2) return;
      if (guide.locked) {
        onSelectGuide?.(guide.id);
        return;
      }
      altDuplicateRef.current = e.altKey;
      draggingRef.current = guide.id;
      onSelectGuide?.(guide.id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onSelectGuide],
  );

  const handleContextMenu = useCallback(
    (guide: Guide, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, guideId: guide.id });
      onSelectGuide?.(guide.id);
    },
    [onSelectGuide],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handlePointerMove = useCallback(
    (guide: Guide, e: React.PointerEvent) => {
      if (draggingRef.current !== guide.id) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const viewport = getEditorViewport();
      const world = Math.round(
        screenToGuidePosition(
          { axis: guide.axis, position: guide.position },
          screenX,
          screenY,
          camState,
          viewport,
        ),
      );
      if (altDuplicateRef.current && onDuplicateGuide) {
        const newId = onDuplicateGuide(guide.id, world);
        altDuplicateRef.current = false;
        draggingRef.current = newId;
        onSelectGuide?.(newId);
      } else {
        onMoveGuide(guide.id, world);
      }
    },
    [camState, onMoveGuide, onDuplicateGuide, onSelectGuide],
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
    altDuplicateRef.current = false;
  }, []);

  const handleOverlayPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const viewport = getEditorViewport();
      const hitRadiusSq = (GUIDE_HIT / 2) ** 2;
      let nearest: string | null = null;
      let nearestDist = hitRadiusSq;
      for (const guide of guides) {
        const dist = distanceSqToGuideLine(
          { axis: guide.axis, position: guide.position },
          camState,
          viewport,
          screenX,
          screenY,
        );
        if (dist <= nearestDist) {
          nearestDist = dist;
          nearest = guide.id;
        }
      }
      setHoveredId(nearest);
    },
    [guides, camState],
  );

  const ctxGuide = contextMenu ? guides.find((g) => g.id === contextMenu.guideId) : null;

  if (!visible || guides.length === 0) return null;

  return (
    <div
      className="guide-overlay"
      aria-hidden
      ref={containerRef}
      onPointerMove={handleOverlayPointerMove}
      onPointerLeave={() => setHoveredId(null)}
    >
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative guide overlay */}
      <svg
        className="guide-overlay__svg"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        aria-hidden
      >
        {guides.map((guide) => {
          const line = lineForGuide(guide);
          const isHover = hoveredId === guide.id || draggingRef.current === guide.id;
          const isSelected = selectedGuideId === guide.id;
          const color = guide.color ?? 'var(--color-accent-primary, #39d0c6)';
          const midX = (line.x1 + line.x2) / 2;
          const midY = (line.y1 + line.y2) / 2;

          return (
            <g key={guide.id}>
              <line
                className="guide-overlay__line"
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke={color}
                strokeWidth={isSelected ? 2.5 : isHover ? 2 : 1}
                strokeDasharray={guide.locked ? '4 2' : '2 2'}
                style={{ pointerEvents: 'none' }}
              />
              {/* Invisible hit stroke for drag + context menu */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG line hit target for guide drag */}
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke="transparent"
                strokeWidth={GUIDE_HIT}
                style={{
                  pointerEvents: 'auto',
                  cursor: guide.locked ? 'default' : 'grab',
                }}
                onPointerDown={(e) => handlePointerDown(guide, e)}
                onPointerMove={(e) => handlePointerMove(guide, e)}
                onPointerUp={handlePointerUp}
                onContextMenu={(e) => handleContextMenu(guide, e)}
              />
              {isHover && (
                <>
                  <circle cx={midX} cy={midY} r={4} fill={color} opacity={0.7} />
                  <text x={midX + 6} y={midY + 4} fontSize={10} fill="var(--color-text-primary)">
                    {guide.position}
                    {guide.locked ? ' (locked)' : ''}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {ctxGuide && contextMenu && (
        <GuideContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          guideId={contextMenu.guideId}
          isLocked={ctxGuide.locked ?? false}
          onToggleLock={onToggleLock}
          onRemove={onRemoveGuide}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
