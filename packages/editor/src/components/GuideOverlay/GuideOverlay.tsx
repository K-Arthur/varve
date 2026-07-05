import type { Guide } from '@strata/scene';
import { useCallback, useRef, useState } from 'react';
import { GuideContextMenu } from './GuideContextMenu';
import './GuideOverlay.css';

interface GuideOverlayProps {
  guides: Guide[];
  zoom: number;
  pan: { x: number; y: number };
  onMoveGuide: (id: string, position: number) => void;
  onRemoveGuide: (id: string) => void;
  onToggleLock: (id: string) => void;
}

const GUIDE_HIT = 8;
const MAX_EXTENT = 99999;

export function GuideOverlay({
  guides,
  zoom,
  pan,
  onMoveGuide,
  onRemoveGuide,
  onToggleLock,
}: GuideOverlayProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    guideId: string;
  } | null>(null);
  const draggingRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const screenPos = useCallback(
    (guide: Guide): number => {
      return guide.position * zoom + (guide.axis === 'vertical' ? pan.x : pan.y);
    },
    [zoom, pan.x, pan.y],
  );

  const handlePointerDown = useCallback((guide: Guide, e: React.PointerEvent) => {
    if (e.button === 2) return;
    if (guide.locked) return;
    draggingRef.current = guide.id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleContextMenu = useCallback((guide: Guide, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, guideId: guide.id });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handlePointerMove = useCallback(
    (guide: Guide, e: React.PointerEvent) => {
      if (draggingRef.current !== guide.id) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pos = guide.axis === 'vertical' ? e.clientX - rect.left : e.clientY - rect.top;
      const world = Math.round((pos - (guide.axis === 'vertical' ? pan.x : pan.y)) / zoom);
      onMoveGuide(guide.id, world);
    },
    [zoom, pan.x, pan.y, onMoveGuide],
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const ctxGuide = contextMenu ? guides.find((g) => g.id === contextMenu.guideId) : null;

  if (guides.length === 0) return null;

  return (
    <div className="guide-overlay" aria-hidden ref={containerRef}>
      {guides.map((guide) => {
        const pos = screenPos(guide);
        const isHover = hoveredId === guide.id || draggingRef.current === guide.id;
        const color = guide.color ?? 'var(--color-accent-primary, #39d0c6)';

        return (
          <div key={guide.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {/* Guide line */}
            {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative guide overlay */}
            <svg
              className="guide-overlay__svg"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              aria-hidden
            >
              <line
                x1={guide.axis === 'vertical' ? pos : 0}
                y1={guide.axis === 'vertical' ? 0 : pos}
                x2={guide.axis === 'vertical' ? pos : MAX_EXTENT}
                y2={guide.axis === 'vertical' ? MAX_EXTENT : pos}
                stroke={color}
                strokeWidth={isHover ? 2 : 1}
                strokeDasharray={guide.locked ? '4 2' : '2 2'}
                style={{ pointerEvents: 'none' }}
              />
            </svg>

            {/* Hit area for dragging */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: drag + context menu hit area */}
            <div
              style={
                {
                  position: 'absolute',
                  [guide.axis === 'vertical' ? 'left' : 'top']: pos - GUIDE_HIT / 2,
                  [guide.axis === 'vertical' ? 'top' : 'left']: 0,
                  [guide.axis === 'vertical' ? 'width' : 'height']: GUIDE_HIT,
                  [guide.axis === 'vertical' ? 'height' : 'width']: '100%',
                  cursor: guide.locked ? 'default' : 'grab',
                  pointerEvents: 'auto',
                  zIndex: 1,
                } as React.CSSProperties
              }
              onPointerDown={(e) => handlePointerDown(guide, e)}
              onPointerMove={(e) => handlePointerMove(guide, e)}
              onPointerUp={handlePointerUp}
              onPointerEnter={() => setHoveredId(guide.id)}
              onPointerLeave={() => setHoveredId(null)}
              onContextMenu={(e) => handleContextMenu(guide, e)}
            />

            {/* Edge handle indicator (visible on hover) */}
            {isHover && (
              <div
                style={
                  {
                    position: 'absolute',
                    [guide.axis === 'vertical' ? 'left' : 'top']: pos - 4,
                    [guide.axis === 'vertical' ? 'top' : 'left']: 0,
                    [guide.axis === 'vertical' ? 'width' : 'height']: 8,
                    [guide.axis === 'vertical' ? 'height' : 'width']: 20,
                    background: color,
                    borderRadius: guide.axis === 'vertical' ? '0 0 4px 4px' : '0 4px 4px 0',
                    pointerEvents: 'none',
                    opacity: 0.7,
                  } as React.CSSProperties
                }
              />
            )}

            {/* Tooltip */}
            {isHover && (
              <div
                style={
                  {
                    position: 'absolute',
                    [guide.axis === 'vertical' ? 'left' : 'top']: pos + 6,
                    [guide.axis === 'vertical' ? 'top' : 'left']: 6,
                    padding: '2px 6px',
                    background: 'var(--color-surface-raised)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 3,
                    fontSize: 10,
                    color: 'var(--color-text-primary)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    zIndex: 2,
                  } as React.CSSProperties
                }
              >
                {guide.position}
                {guide.locked ? ' (locked)' : ''}
              </div>
            )}
          </div>
        );
      })}
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
