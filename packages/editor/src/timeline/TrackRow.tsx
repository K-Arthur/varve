import type { AnimationTrack, Timeline } from '@varve/scene';
import { Icon, Select, Tooltip } from '@varve/ui';
import { type FC, memo, useCallback, useRef, useState } from 'react';

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

/**
 * When multiple keyframes are within KEYFRAME_CLICK_EPSILON pixels of the
 * click point (low zoom), select the geometrically nearest one rather than
 * whichever DOM element paints on top.
 */
function findNearestKeyframe(
  keyframes: AnimationTrack['keyframes'],
  duration: number,
  zoom: number,
  clientX: number,
  container: HTMLLIElement | null,
): number | null {
  if (!container || keyframes.length === 0) return null;
  const rect = container.getBoundingClientRect();
  const EPSILON = 6;
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i]!;
    const x = rect.left + kf.progress * duration * zoom;
    const dist = Math.abs(clientX - x);
    if (dist < EPSILON && dist < bestDist) {
      bestDist = dist;
      best = kf!.progress;
    }
  }
  return best;
}

const TrackRowInner: FC<TrackRowProps> = ({
  track,
  nodeName,
  duration,
  zoom,
  selected,
  selectedKeyframeIndex,
  timelines,
  activeTimelineId: _activeTimelineId,
  onSelectTrack,
  onClickKeyframe,
  onSetNestedTimeline,
  onDeleteKeyframe,
  onMoveKeyframe,
  onSetMuted,
  onSetSolo,
}) => {
  const trackRef = useRef<HTMLLIElement>(null);
  const [draggingKf, setDraggingKf] = useState<number | null>(null);

  const handleRowClick = useCallback(() => {
    onSelectTrack(track.id);
  }, [onSelectTrack, track.id]);

  /**
   * Dense disambiguation: when keyframe buttons overlap (low zoom), choose
   * the one geometrically nearest the click point.
   */
  const resolveKeyframeClick = useCallback(
    (clickClientX: number, fallbackProgress: number) => {
      const nearest = findNearestKeyframe(
        track.keyframes,
        duration,
        zoom,
        clickClientX,
        trackRef.current,
      );
      onClickKeyframe(track.id, nearest ?? fallbackProgress);
    },
    [track.keyframes, track.id, duration, zoom, onClickKeyframe],
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
      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          onSelectTrack(track.id);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          if (selectedKeyframeIndex !== null && selectedKeyframeIndex > 0 && onMoveKeyframe) {
            const cur = track.keyframes[selectedKeyframeIndex];
            const prev = track.keyframes[selectedKeyframeIndex - 1];
            if (cur && prev) onMoveKeyframe(cur.progress, prev.progress);
          }
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (
            selectedKeyframeIndex !== null &&
            selectedKeyframeIndex < track.keyframes.length - 1 &&
            onMoveKeyframe
          ) {
            const cur = track.keyframes[selectedKeyframeIndex];
            const next = track.keyframes[selectedKeyframeIndex + 1];
            if (cur && next) onMoveKeyframe(cur.progress, next.progress);
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (selectedKeyframeIndex !== null && onDeleteKeyframe) {
            const kf = track.keyframes[selectedKeyframeIndex];
            if (kf) onDeleteKeyframe(kf.progress);
          }
          return;
        default:
          return;
      }
    },
    [
      selectedKeyframeIndex,
      track.keyframes,
      onDeleteKeyframe,
      onSelectTrack,
      track.id,
      onMoveKeyframe,
    ],
  );

  const isMuted = track.muted ?? false;
  const isSolo = track.solo ?? false;

  return (
    <li
      className={`timeline-track-row ${selected ? 'timeline-track-row--selected' : ''} ${isMuted ? 'timeline-track-row--muted' : ''}`}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      ref={trackRef}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-editable composite row (Enter selects the track, ArrowLeft/Right step the selected keyframe, Delete removes it); the row-level handlers cannot live on the keyframe dots
      tabIndex={0}
      aria-label={`Track: ${nodeName} ${track.property}${isMuted ? ' (muted)' : ''}`}
    >
      <div className="timeline-track-row__label">
        <div className="timeline-track-row__label-header">
          <span className="timeline-track-row__node-name">{nodeName}</span>
          {onSetMuted && (
            <Tooltip label={isMuted ? 'Unmute track' : 'Mute track'}>
              <button
                type="button"
                className={`timeline-track-row__mute-btn ${isMuted ? 'timeline-track-row__mute-btn--active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetMuted(!isMuted);
                }}
                aria-label={isMuted ? 'Unmute track' : 'Mute track'}
                aria-pressed={isMuted}
              >
                <Icon name={isMuted ? 'VolumeX' : 'Volume2'} size={11} />
              </button>
            </Tooltip>
          )}
          {onSetSolo && (
            <Tooltip label={isSolo ? 'Unsolo track' : 'Solo track'}>
              <button
                type="button"
                className={`timeline-track-row__solo-btn ${isSolo ? 'timeline-track-row__solo-btn--active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetSolo(!isSolo);
                }}
                aria-label={isSolo ? 'Unsolo track' : 'Solo track'}
                aria-pressed={isSolo}
              >
                S
              </button>
            </Tooltip>
          )}
        </div>
        <span className="timeline-track-row__prop-name">
          {track.nestedTimelineId ? 'nested' : track.property}
        </span>
        {selected && onSetNestedTimeline && (
          <div className="timeline-track-row__nested">
            <span className="timeline-track-row__nested-label">Nested</span>
            <Select
              label="Nested timeline"
              value={track.nestedTimelineId ?? ''}
              options={[
                { value: '', label: 'None' },
                ...(timelines
                  ? Object.keys(timelines).map((id) => ({
                      value: id,
                      label: timelines[id]?.name ?? id,
                    }))
                  : []),
              ]}
              onChange={(val) => {
                onSetNestedTimeline(
                  track.id,
                  val === '' ? null : val,
                  track.nestedStartProgress ?? 0,
                );
              }}
            />
          </div>
        )}
      </div>
      <div className="timeline-track-row__track">
        {track.keyframes.map((kf, i) => {
          const x = kf.progress * duration * zoom;
          const isSelected = selectedKeyframeIndex === i;
          const isDragging = draggingKf === i;
          return (
            <button
              key={kf.progress}
              type="button"
              className={`timeline-track-row__keyframe ${isSelected ? 'timeline-track-row__keyframe--selected' : ''} ${isDragging ? 'timeline-track-row__keyframe--dragging' : ''}`}
              style={{ left: x, position: 'absolute' }}
              onClick={(e) => {
                e.stopPropagation();
                if (e.detail === 0) {
                  // Keyboard activation: clientX is 0, which would make the
                  // geometry resolver pick the leftmost keyframe instead of
                  // the focused one.
                  onClickKeyframe(track.id, kf.progress);
                } else {
                  resolveKeyframeClick(e.clientX, kf.progress);
                }
              }}
              onMouseDown={handleKeyframeMouseDown(kf.progress, i)}
              onKeyDown={(e) => {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                  onDeleteKeyframe?.(kf.progress);
                }
              }}
              tabIndex={0}
              aria-label={`Keyframe at ${Math.round(kf.progress * 100)}%`}
            />
          );
        })}
      </div>
    </li>
  );
};

/**
 * TrackRow renders no playback-time-dependent content (keyframe positions are
 * absolute in track space), so a per-frame currentTime change must never
 * re-render rows. Callbacks are intentionally excluded from the comparison:
 * they are recreated by TimelinePanel/Shell on every render but capture only
 * stable editor methods and track/timeline ids that ARE compared below.
 */
function areTrackRowPropsEqual(prev: TrackRowProps, next: TrackRowProps): boolean {
  return (
    prev.track === next.track &&
    prev.nodeName === next.nodeName &&
    prev.duration === next.duration &&
    prev.zoom === next.zoom &&
    prev.selected === next.selected &&
    prev.selectedKeyframeIndex === next.selectedKeyframeIndex &&
    prev.timelines === next.timelines &&
    prev.activeTimelineId === next.activeTimelineId
  );
}

export const TrackRow = memo(TrackRowInner, areTrackRowPropsEqual);
