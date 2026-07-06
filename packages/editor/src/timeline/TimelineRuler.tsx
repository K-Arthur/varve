import { type FC, useCallback, useRef } from 'react';

export interface TimelineRulerProps {
  duration: number;
  currentTime: number;
  zoom: number;
  onSeek: (time: number) => void;
  markers?: Array<{ id: string; name: string; progress: number }>;
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
}) => {
  const rulerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

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
    <div
      ref={rulerRef}
      className="timeline-ruler"
      onMouseDown={handleMouseDown}
      role="slider"
      aria-label="Timeline ruler"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
      tabIndex={0}
      style={{ width: totalWidth }}
    >
      {ticks.map((tick, i) => (
        <div
          key={i}
          className="timeline-ruler__tick"
          style={{ left: tick.x, position: 'absolute', top: 0 }}
        >
          <div className="timeline-ruler__tick-mark" />
          {tick.label && <span className="timeline-ruler__tick-label">{tick.label}</span>}
        </div>
      ))}
      {markers.map((marker) => (
        <div
          key={marker.id}
          className="timeline-ruler__marker"
          style={{ left: marker.progress * duration * zoom, position: 'absolute', top: 0 }}
          title={marker.name}
        />
      ))}
      <div
        className="timeline-ruler__playhead"
        style={{ left: playheadX, position: 'absolute', top: 0, height: '100%' }}
      />
    </div>
  );
};
