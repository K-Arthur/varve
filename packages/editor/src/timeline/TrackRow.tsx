import type { AnimationTrack } from '@strata/scene';
import { type FC, useCallback } from 'react';

export interface TrackRowProps {
  track: AnimationTrack;
  nodeName: string;
  duration: number;
  zoom: number;
  selected: boolean;
  selectedKeyframeIndex: number | null;
  onSelectTrack: (trackId: string) => void;
  onClickKeyframe: (trackId: string, progress: number) => void;
}

export const TrackRow: FC<TrackRowProps> = ({
  track,
  nodeName,
  duration,
  zoom,
  selected,
  selectedKeyframeIndex,
  onSelectTrack,
  onClickKeyframe,
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
        <span className="timeline-track-row__prop-name">{track.property}</span>
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
