import type { AnimationTrack, Timeline } from '@strata/scene';
import { type FC, useCallback } from 'react';

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
}) => {
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

  const nestedOptions = Object.values(timelines).filter((tl) => tl.id !== activeTimelineId);

  return (
    <div
      className={`timeline-track-row ${selected ? 'timeline-track-row--selected' : ''}`}
      onClick={handleRowClick}
      role="button"
      tabIndex={0}
      aria-label={`Track: ${nodeName} ${track.property}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectTrack(track.id);
        }
      }}
    >
      <div className="timeline-track-row__label">
        <span className="timeline-track-row__node-name">{nodeName}</span>
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
          return (
            <div
              key={i}
              className={`timeline-track-row__keyframe ${isSelected ? 'timeline-track-row__keyframe--selected' : ''}`}
              style={{ left: x, position: 'absolute' }}
              onClick={handleKeyframeClick(kf.progress)}
              role="button"
              tabIndex={-1}
              aria-label={`Keyframe at ${Math.round(kf.progress * 100)}%`}
            />
          );
        })}
      </div>
    </div>
  );
};
