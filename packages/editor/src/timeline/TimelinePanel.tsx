import type { Timeline } from '@strata/scene';
import { type FC, useCallback, useMemo } from 'react';
import { PlaybackControls } from './PlaybackControls';
import { TimelineRuler } from './TimelineRuler';
import { TrackRow } from './TrackRow';
import './TimelinePanel.css';

export interface TimelinePanelProps {
  timelines: Record<string, Timeline>;
  activeTimelineId: string | null;
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;
  loop: boolean;
  selectedTrackIds: string[];
  selectedKeyframeIndex: number | null;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onSpeedChange: (speed: number) => void;
  onToggleLoop: () => void;
  onSelectTimeline: (id: string | null) => void;
  onSelectTrack: (trackId: string) => void;
  onClickKeyframe: (trackId: string, progress: number) => void;
  getNodeName?: (nodeId: string) => string | undefined;
}

export const TimelinePanel: FC<TimelinePanelProps> = ({
  timelines,
  activeTimelineId,
  currentTime,
  isPlaying,
  playbackSpeed,
  loop,
  selectedTrackIds,
  selectedKeyframeIndex,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSpeedChange,
  onToggleLoop,
  onSelectTimeline,
  onSelectTrack,
  onClickKeyframe,
  getNodeName,
}) => {
  const timelineIds = useMemo(() => Object.keys(timelines), [timelines]);
  const activeTimeline = activeTimelineId ? (timelines[activeTimelineId] ?? null) : null;
  const duration = activeTimeline?.duration ?? 0;
  const tracks = activeTimeline?.tracks ?? [];
  const zoom = 1;

  const handleTimelineSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      onSelectTimeline(val === '' ? null : val);
    },
    [onSelectTimeline],
  );

  const handleStepForward = useCallback(() => {
    const step = 100;
    onSeek(Math.min(duration, currentTime + step));
  }, [duration, currentTime, onSeek]);

  const handleStepBackward = useCallback(() => {
    const step = 100;
    onSeek(Math.max(0, currentTime - step));
  }, [currentTime, onSeek]);

  return (
    <div className="timeline-panel">
      <div className="timeline-panel__header">
        <select
          className="timeline-panel__selector"
          value={activeTimelineId ?? ''}
          onChange={handleTimelineSelect}
          aria-label="Select timeline"
        >
          <option value="">No timeline</option>
          {timelineIds.map((id) => (
            <option key={id} value={id}>
              {timelines[id]?.name ?? id}
            </option>
          ))}
        </select>
      </div>

      {!activeTimeline ? (
        <div className="timeline-panel__empty">No timeline selected</div>
      ) : (
        <>
          <PlaybackControls
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            speed={playbackSpeed}
            loop={loop}
            onPlay={onPlay}
            onPause={onPause}
            onStop={onStop}
            onStepForward={handleStepForward}
            onStepBackward={handleStepBackward}
            onSeek={onSeek}
            onSpeedChange={onSpeedChange}
            onToggleLoop={onToggleLoop}
          />

          <div className="timeline-panel__ruler-container">
            <TimelineRuler
              duration={duration}
              currentTime={currentTime}
              zoom={zoom}
              onSeek={onSeek}
            />
          </div>

          <div className="timeline-panel__tracks">
            {tracks.length === 0 ? (
              <div className="timeline-panel__empty-tracks">No tracks in this timeline</div>
            ) : (
              tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  nodeName={getNodeName?.(track.nodeId) ?? track.nodeId}
                  duration={duration}
                  zoom={zoom}
                  selected={selectedTrackIds.includes(track.id)}
                  selectedKeyframeIndex={selectedKeyframeIndex}
                  onSelectTrack={onSelectTrack}
                  onClickKeyframe={onClickKeyframe}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
