import { ContextMenu, type MenuEntry, Tooltip } from '@varve/ui';
import { type FC, useCallback, useRef, useState } from 'react';

export interface TimelineRulerProps {
  duration: number;
  currentTime: number;
  zoom: number;
  onSeek: (time: number) => void;
  markers?: Array<{ id: string; name: string; progress: number }>;
  onAddMarker?: (timeMs: number) => void;
  onRenameMarker?: (markerId: string) => void;
  onDeleteMarker?: (markerId: string) => void;
}

function getTickInterval(zoom: number): number {
  if (zoom >= 100) return 50;
  if (zoom >= 50) return 100;
  if (zoom >= 20) return 250;
  if (zoom >= 10) return 500;
  return 1000;
}

export const TimelineRuler: FC<TimelineRulerProps> = ({
  duration,
  currentTime,
  zoom,
  onSeek,
  markers = [],
  onAddMarker,
  onRenameMarker,
  onDeleteMarker,
}) => {
  const rulerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const [ctxMarkerId, setCtxMarkerId] = useState<string | null>(null);

  const computeTimeFromEvent = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const time = Math.max(0, Math.min(duration, x / zoom));
      return time;
    },
    [duration, zoom],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      isDragging.current = true;
      const time = computeTimeFromEvent(e.clientX);
      onSeek(time);

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const t = computeTimeFromEvent(ev.clientX);
        onSeek(t);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [computeTimeFromEvent, onSeek],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 500 : 100;
      let newTime = currentTime;
      switch (e.key) {
        case 'ArrowLeft':
          newTime = Math.max(0, currentTime - step);
          break;
        case 'ArrowRight':
          newTime = Math.min(duration, currentTime + step);
          break;
        case 'Home':
          newTime = 0;
          break;
        case 'End':
          newTime = duration;
          break;
        default:
          return;
      }
      e.preventDefault();
      onSeek(newTime);
    },
    [currentTime, duration, onSeek],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onAddMarker) return;
      const time = computeTimeFromEvent(e.clientX);
      onAddMarker(time);
    },
    [computeTimeFromEvent, onAddMarker],
  );

  const handleMarkerContextMenu = useCallback((e: React.MouseEvent, markerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxPos({ x: e.clientX, y: e.clientY });
    setCtxMarkerId(markerId);
  }, []);

  const closeContextMenu = useCallback(() => {
    setCtxPos(null);
    setCtxMarkerId(null);
  }, []);

  const ctxItems: MenuEntry[] = [];
  if (onRenameMarker && ctxMarkerId) {
    ctxItems.push({
      id: 'rename',
      label: 'Rename marker',
      onAction: () => {
        onRenameMarker(ctxMarkerId);
        closeContextMenu();
      },
    });
  }
  if (onDeleteMarker && ctxMarkerId) {
    ctxItems.push({
      id: 'delete',
      label: 'Delete marker',
      onAction: () => {
        onDeleteMarker(ctxMarkerId);
        closeContextMenu();
      },
    });
  }

  const interval = getTickInterval(zoom);
  const totalWidth = duration * zoom;
  const ticks: { x: number; label?: string }[] = [];
  for (let t = 0; t <= duration; t += interval) {
    const x = t * zoom;
    const seconds = t / 1000;
    const isLabel = Math.round(seconds * 1000) % (interval * 5) === 0;
    ticks.push({
      x,
      label: isLabel ? `${seconds.toFixed(1)}s` : undefined,
    });
  }

  const playheadX = currentTime * zoom;

  return (
    <>
      <div
        ref={rulerRef}
        className="timeline-ruler"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        role="slider"
        aria-label="Timeline ruler"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        tabIndex={0}
        style={{ width: totalWidth }}
      >
        {ticks.map((tick) => (
          <div
            key={tick.x}
            className="timeline-ruler__tick"
            style={{ left: tick.x, position: 'absolute', top: 0 }}
          >
            <div className="timeline-ruler__tick-mark" />
            {tick.label && <span className="timeline-ruler__tick-label">{tick.label}</span>}
          </div>
        ))}
        {markers.map((marker) => (
          <Tooltip key={marker.id} label={marker.name}>
            <button
              type="button"
              className="timeline-ruler__marker"
              style={{ left: marker.progress * duration * zoom, position: 'absolute', top: 0 }}
              aria-label={`Marker: ${marker.name}`}
              onContextMenu={(e) => handleMarkerContextMenu(e, marker.id)}
              onKeyDown={(e) => {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault();
                  e.stopPropagation();
                  onDeleteMarker?.(marker.id);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  onRenameMarker?.(marker.id);
                }
              }}
            />
          </Tooltip>
        ))}
        <div
          className="timeline-ruler__playhead"
          role="slider"
          aria-label="Playhead position"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          tabIndex={0}
          style={{ left: playheadX, position: 'absolute', top: 0, height: '100%' }}
        />
      </div>
      <ContextMenu
        items={ctxItems}
        position={ctxPos}
        onClose={closeContextMenu}
        label="Marker context menu"
      />
    </>
  );
};
