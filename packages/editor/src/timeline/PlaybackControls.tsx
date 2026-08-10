import { Icon, Select } from '@varve/ui';
import { type FC, useCallback } from 'react';

export interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  loop: boolean;
  autoKeyframe?: boolean;
  onionSkin?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onStepForward?: () => void;
  onStepBackward?: () => void;
  onSeek: (time: number) => void;
  onSpeedChange: (speed: number) => void;
  onToggleLoop: () => void;
  onToggleAutoKeyframe?: () => void;
  onToggleOnionSkin?: () => void;
  onSavePreset?: () => void;
  presetOptions?: Array<{ id: string; name: string }>;
  onApplyPreset?: (presetId: string) => void;
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
  autoKeyframe = false,
  onionSkin = false,
  onPlay,
  onPause,
  onStop,
  onStepForward,
  onStepBackward,
  onSeek: _onSeek,
  onSpeedChange,
  onToggleLoop,
  onToggleAutoKeyframe,
  onToggleOnionSkin,
  onSavePreset,
  presetOptions = [],
  onApplyPreset,
}) => {
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      onPause();
    } else {
      onPlay();
    }
  }, [isPlaying, onPlay, onPause]);

  return (
    <div
      className="timeline-playback-controls"
      role="toolbar"
      aria-label="Timeline playback controls"
    >
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

      {onToggleAutoKeyframe && (
        <button
          type="button"
          className={`timeline-playback-btn ${autoKeyframe ? 'timeline-playback-btn--active' : ''}`}
          onClick={onToggleAutoKeyframe}
          aria-label={autoKeyframe ? 'Disable auto-keyframe' : 'Enable auto-keyframe'}
          aria-pressed={autoKeyframe}
        >
          <Icon name="Diamond" size={14} />
        </button>
      )}

      {onToggleOnionSkin && (
        <button
          type="button"
          className={`timeline-playback-btn ${onionSkin ? 'timeline-playback-btn--active' : ''}`}
          onClick={onToggleOnionSkin}
          aria-label={onionSkin ? 'Disable onion skinning' : 'Enable onion skinning'}
          aria-pressed={onionSkin}
        >
          <Icon name="Layers" size={14} />
        </button>
      )}

      {onSavePreset && (
        <button
          type="button"
          className="timeline-playback-btn"
          onClick={onSavePreset}
          aria-label="Save timeline as motion preset"
        >
          <Icon name="Save" size={14} />
        </button>
      )}

      {onApplyPreset && presetOptions.length > 0 && (
        <Select
          label="Apply motion preset"
          value=""
          placeholder="Apply preset"
          options={presetOptions.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => {
            if (id) {
              onApplyPreset(id);
            }
          }}
        />
      )}

      <Select
        label="Playback speed"
        value={String(speed)}
        options={SPEED_OPTIONS.map((s) => ({ value: String(s), label: `${s}x` }))}
        onChange={(v) => onSpeedChange(Number(v))}
      />

      <span className="timeline-playback-sep" aria-hidden />

      <time className="timeline-playback-time" role="timer" aria-label="Current time">
        {formatTime(currentTime)}
      </time>

      <span className="timeline-playback-time-sep" aria-hidden>
        /
      </span>

      <time className="timeline-playback-time" role="timer" aria-label="Duration">
        {formatTime(duration)}
      </time>

      <span className="sr-only" role="status" aria-live="polite">
        {isPlaying ? 'Playback started' : 'Playback paused'}
      </span>
    </div>
  );
};
