import { Icon } from '@strata/ui';
import { type FC, useCallback } from 'react';

export interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  loop: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onStepForward?: () => void;
  onStepBackward?: () => void;
  onSeek: (time: number) => void;
  onSpeedChange: (speed: number) => void;
  onToggleLoop: () => void;
}

export function formatTime(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

export const PlaybackControls: FC<PlaybackControlsProps> = ({
  isPlaying,
  currentTime,
  duration,
  speed,
  loop,
  onPlay,
  onPause,
  onStop,
  onStepForward,
  onStepBackward,
  onSeek: _onSeek,
  onSpeedChange,
  onToggleLoop,
}) => {
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      onPause();
    } else {
      onPlay();
    }
  }, [isPlaying, onPlay, onPause]);

  return (
    <div className="timeline-playback-controls">
      <button
        type="button"
        className="timeline-playback-btn"
        onClick={handlePlayPause}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        <Icon name={isPlaying ? 'Pause' : 'Play'} size={14} />
      </button>

      <button type="button" className="timeline-playback-btn" onClick={onStop} aria-label="Stop">
        <Icon name="Square" size={14} />
      </button>

      <span className="timeline-playback-sep" aria-hidden />

      <button
        type="button"
        className="timeline-playback-btn"
        onClick={onStepBackward}
        aria-label="Step backward"
        disabled={!onStepBackward}
      >
        <Icon name="SkipBack" size={14} />
      </button>

      <button
        type="button"
        className="timeline-playback-btn"
        onClick={onStepForward}
        aria-label="Step forward"
        disabled={!onStepForward}
      >
        <Icon name="SkipForward" size={14} />
      </button>

      <span className="timeline-playback-sep" aria-hidden />

      <button
        type="button"
        className={`timeline-playback-btn ${loop ? 'timeline-playback-btn--active' : ''}`}
        onClick={onToggleLoop}
        aria-label={loop ? 'Disable loop' : 'Enable loop'}
      >
        <Icon name="Repeat" size={14} />
      </button>

      <select
        className="timeline-playback-speed"
        value={speed}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
        aria-label="Playback speed"
      >
        {SPEED_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>

      <span className="timeline-playback-sep" aria-hidden />

      <span className="timeline-playback-time" aria-label="Current time">
        {formatTime(currentTime)}
      </span>

      <span className="timeline-playback-time-sep" aria-hidden>
        /
      </span>

      <span className="timeline-playback-time" aria-label="Duration">
        {formatTime(duration)}
      </span>
    </div>
  );
};
