import type { AnimationTrack, Timeline } from '@strata/scene';
import { Icon } from '@strata/ui';
import { type FC, useCallback, useRef, useState } from 'react';

export interface TrackRowProps {
  track: AnimationTrack;
  nodeName: string;
  duration: number;
  zoom: number;
  selected: boolean;
  selectedKeyframeIndex: number | null;
  timelines: Record<string, Timeline>;
  activeTimelineId: string | null;
  onSelectTrack: (trackId: string) => void;
  onClickKeyframe: (trackId: string, progress: number) => void;
  onSetNestedTimeline?: (
    trackId: string,
    nestedTimelineId: string | null,
    startProgress?: number,
  ) => void;
  onDeleteKeyframe?: (progress: number) => void;
  onMoveKeyframe?: (oldProgress: number, newProgress: number) => void;
  onSetMuted?: (muted: boolean) => void;
  onSetSolo?: (solo: boolean) => void;
}

export const TrackRow: FC<TrackRowProps> = ({
  track,
  nodeName,
  duration,
  zoom,
  selected,
  selectedKeyframeIndex,
  timelines,
  activeTimelineId,
  onSelectTrack,
  onClickKeyframe,
  onSetNestedTimeline,
  onDeleteKeyframe,
  onMoveKeyframe,
  onSetMuted,
  onSetSolo,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [draggingKf, setDraggingKf] = useState<number | null>(null);

  const handleRowClick = useCallback(() => {
    onSelectTrack(track.id);
  }, [onSelectTrack, track.id]);

  const handleKeyframeClick = useCallback(
    (progress: number) => (e: React.MouseEvent) => {
      e.stopPropagation();
      onClickKeyframe(track.id, progress);
    },
    [onClickKeyframe, track.id],
  );

  const handleKeyframeMouseDown = useCallback(
    (progress: number, index: number) => (e: React.MouseEvent) => {
      if (!onMoveKeyframe) return;
      e.stopPropagation();
      setDraggingKf(index);

      const startX = e.clientX;
      const startProgress = progress;
      const trackWidth = trackRef.current?.clientWidth ?? 1;

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dProgress = dx / trackWidth / zoom;
        const newProgress = Math.max(0, Math.min(1, startProgress + dProgress));
        onMoveKeyframe(startProgress, newProgress);
      };

      const handleUp = () => {
        setDraggingKf(null);
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [onMoveKeyframe, zoom],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedKeyframeIndex !== null && onDeleteKeyframe) {
          const kf = track.keyframes[selectedKeyframeIndex];
          if (kf) onDeleteKeyframe(kf.progress);
        }
      }
    },
    [selectedKeyframeIndex, track.keyframes, onDeleteKeyframe],
  );

  const nestedOptions = Object.values(timelines).filter((tl) => tl.id !== activeTimelineId);
  const isMuted = track.muted ?? false;
  const isSolo = track.solo ?? false;

  return (
    <div
      className={`timeline-track-row ${selected ? 'timeline-track-row--selected' : ''} ${isMuted ? 'timeline-track-row--muted' : ''}`}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      ref={trackRef}
      role="button"
      tabIndex={0}
      aria-label={`Track: ${nodeName} ${track.property}${isMuted ? ' (muted)' : ''}`}
    >
      <div className="timeline-track-row__label">
        <div className="timeline-track-row__label-header">
          <span className="timeline-track-row__node-name">{nodeName}</span>
          {onSetMuted && (
            <button
              type="button"
              className={`timeline-track-row__mute-btn ${isMuted ? 'timeline-track-row__mute-btn--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onSetMuted(!isMuted);
              }}
              aria-label={isMuted ? 'Unmute track' : 'Mute track'}
              aria-pressed={isMuted}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              <Icon name={isMuted ? 'VolumeX' : 'Volume2'} size={11} />
            </button>
          )}
          {onSetSolo && (
            <button
              type="button"
              className={`timeline-track-row__solo-btn ${isSolo ? 'timeline-track-row__solo-btn--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onSetSolo(!isSolo);
              }}
              aria-label={isSolo ? 'Unsolo track' : 'Solo track'}
              aria-pressed={isSolo}
              title={isSolo ? 'Unsolo' : 'Solo'}
            >
              S
            </button>
          )}
        </div>
        <span className="timeline-track-row__prop-name">
          {track.nestedTimelineId ? 'nested' : track.property}
        </span>
        {selected && onSetNestedTimeline && (
          <label className="timeline-track-row__nested">
            <span className="timeline-track-row__nested-label">Nested</span>
            <select
              value={track.nestedTimelineId ?? ''}
              aria-label="Nested timeline"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const val = e.target.value;
                onSetNestedTimeline(
                  track.id,
                  val === '' ? null : val,
                  track.nestedStartProgress ?? 0,
                );
              }}
            >
              <option value="">None</option>
              {nestedOptions.map((tl) => (
                <option key={tl.id} value={tl.id}>
                  {tl.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="timeline-track-row__track">
        {track.keyframes.map((kf, i) => {
          const x = kf.progress * duration * zoom;
          const isSelected = selectedKeyframeIndex === i;
          const isDragging = draggingKf === i;
          return (
            <button
              key={i}
              type="button"
              className={`timeline-track-row__keyframe ${isSelected ? 'timeline-track-row__keyframe--selected' : ''} ${isDragging ? 'timeline-track-row__keyframe--dragging' : ''}`}
              style={{ left: x, position: 'absolute' }}
              onClick={handleKeyframeClick(kf.progress)}
              onMouseDown={handleKeyframeMouseDown(kf.progress, i)}
              onKeyDown={(e) => {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                  onDeleteKeyframe?.(kf.progress);
                }
              }}
              tabIndex={-1}
              aria-label={`Keyframe at ${Math.round(kf.progress * 100)}%`}
            />
          );
        })}
      </div>
    </div>
  );
};
