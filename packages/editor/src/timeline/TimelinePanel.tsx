import { getMediaRegistry } from '@varve/engine';
import type { Timeline } from '@varve/scene';
import { getAnimatedMediaFill } from '@varve/scene';
import type { EasingDefinition } from '@varve/shared';
import { Select, Tooltip, TooltipProvider } from '@varve/ui';
import { type FC, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { PanelDragHandle } from '../components/PanelDragHandle';
import { EditorCtx } from '../context';
import { GraphEditor } from './GraphEditor';
import { MediaFrameStrip } from './MediaFrameStrip';
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
  autoKeyframe?: boolean;
  onionSkin?: boolean;
  motionPresets?: Record<string, { id: string; name: string }>;
  selectedTrackIds: string[];
  selectedKeyframe: { trackId: string; index: number } | null;
  /** Whether the graph editor panel is visible. */
  graphEditorVisible?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onSpeedChange: (speed: number) => void;
  onToggleLoop: () => void;
  onToggleAutoKeyframe?: () => void;
  onToggleOnionSkin?: () => void;
  onAddMarker?: (timeMs: number) => void;
  onRenameMarker?: (markerId: string) => void;
  onDeleteMarker?: (markerId: string) => void;
  onSavePreset?: () => void;
  onApplyPreset?: (presetId: string) => void;
  onSelectTimeline: (id: string | null) => void;
  onCreateTimeline?: () => void;
  onSelectTrack: (trackId: string) => void;
  onClickKeyframe: (trackId: string, progress: number) => void;
  onSetTrackNestedTimeline?: (
    trackId: string,
    nestedTimelineId: string | null,
    startProgress?: number,
  ) => void;
  getNodeName?: (nodeId: string) => string | undefined;
  onToggleGraphEditor?: () => void;
  onDeleteKeyframe?: (timelineId: string, trackId: string, progress: number) => void;
  onMoveKeyframe?: (
    timelineId: string,
    trackId: string,
    oldProgress: number,
    newProgress: number,
  ) => void;
  onUpdateKeyframeEasing?: (
    timelineId: string,
    trackId: string,
    progress: number,
    easing: EasingDefinition,
  ) => void;
  onSetTrackMuted?: (timelineId: string, trackId: string, muted: boolean) => void;
  onSetTrackSolo?: (timelineId: string, trackId: string, solo: boolean) => void;
}

const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4, 8];

export const TimelinePanel: FC<TimelinePanelProps> = ({
  timelines,
  activeTimelineId,
  currentTime,
  isPlaying,
  playbackSpeed,
  loop,
  autoKeyframe = false,
  onionSkin = false,
  motionPresets = {},
  selectedTrackIds,
  selectedKeyframe,
  graphEditorVisible = false,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSpeedChange,
  onToggleLoop,
  onToggleAutoKeyframe,
  onToggleOnionSkin,
  onAddMarker,
  onRenameMarker,
  onDeleteMarker,
  onSavePreset,
  onApplyPreset,
  onSelectTimeline,
  onCreateTimeline,
  onSelectTrack,
  onClickKeyframe,
  onSetTrackNestedTimeline,
  getNodeName,
  onToggleGraphEditor,
  onDeleteKeyframe,
  onMoveKeyframe,
  onUpdateKeyframeEasing,
  onSetTrackMuted,
  onSetTrackSolo,
}) => {
  const editor = useContext(EditorCtx);
  const mediaStrip = useMemo(() => {
    // The strip is an optional affordance: without the editor provider
    // (isolated renders, previews) the panel renders exactly as before.
    if (!editor) return null;
    const mediaState = editor.state.media;
    const mediaDoc = editor.state.document;
    const selectedId = editor.state.selection[0];
    const node = selectedId ? mediaDoc?.nodes[selectedId] : undefined;
    const fill = node ? getAnimatedMediaFill(node, mediaDoc) : undefined;
    const assetId = fill?.image?.assetId;
    const asset = assetId ? mediaDoc?.assets?.[assetId] : undefined;
    if (!node || !fill?.image || !asset?.animated) return null;
    const session = getMediaRegistry().get(assetId!);
    if (!session) return null;
    return (
      <MediaFrameStrip
        timing={session.timing}
        frameCount={asset.animated.frameCount}
        currentTimeMs={mediaState.currentTime}
        isPlaying={mediaState.isPlaying}
        onScrub={editor.seekMedia}
        onTogglePlay={editor.toggleMedia}
        onStep={editor.stepMediaFrame}
        ariaLabel={`Animated image: ${asset.animated.frameCount} frames`}
      />
    );
  }, [editor]);

  const timelineIds = useMemo(() => Object.keys(timelines), [timelines]);
  const activeTimeline = activeTimelineId ? (timelines[activeTimelineId] ?? null) : null;
  const duration = activeTimeline?.duration ?? 0;
  const tracks = activeTimeline?.tracks ?? [];
  const [zoom, setZoom] = useState(1);
  const tracksContainerRef = useRef<HTMLUListElement>(null);

  const presetOptions = useMemo(
    () => Object.values(motionPresets).map((p) => ({ id: p.id, name: p.name })),
    [motionPresets],
  );

  const handleTimelineSelect = useCallback(
    (val: string) => {
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

  const handleZoomIn = useCallback(() => {
    setZoom((z) => {
      const idx = ZOOM_LEVELS.indexOf(z);
      return idx < 0 || idx >= ZOOM_LEVELS.length - 1 ? z : ZOOM_LEVELS[idx + 1]!;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => {
      const idx = ZOOM_LEVELS.indexOf(z);
      return idx <= 0 ? z : ZOOM_LEVELS[idx - 1]!;
    });
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) handleZoomIn();
        else handleZoomOut();
      }
    },
    [handleZoomIn, handleZoomOut],
  );

  return (
    <div className="timeline-panel" onWheel={handleWheel}>
      <PanelDragHandle
        panelTypeId="timeline"
        panelInstanceId="timeline-primary"
        currentWindowId="main"
        title="Timeline"
      >
        <div className="timeline-panel__header">
          <Select
            label="Select timeline"
            value={activeTimelineId ?? ''}
            options={[
              { value: '', label: 'No timeline' },
              ...timelineIds.map((id) => ({ value: id, label: timelines[id]?.name ?? id })),
            ]}
            onChange={handleTimelineSelect}
          />
          {onCreateTimeline && (
            <button
              type="button"
              className="timeline-panel__create-btn"
              aria-label="Create timeline"
              data-testid="timeline-create"
              onClick={onCreateTimeline}
            >
              New timeline
            </button>
          )}

          <TooltipProvider>
            <div className="timeline-panel__zoom-controls">
              <Tooltip label="Zoom out">
                <button
                  type="button"
                  className="timeline-panel__zoom-btn"
                  onClick={handleZoomOut}
                  disabled={zoom <= ZOOM_LEVELS[0]!}
                  aria-label="Zoom out"
                >
                  −
                </button>
              </Tooltip>
              <span className="timeline-panel__zoom-label">{Math.round(zoom * 100)}%</span>
              <Tooltip label="Zoom in">
                <button
                  type="button"
                  className="timeline-panel__zoom-btn"
                  onClick={handleZoomIn}
                  disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!}
                  aria-label="Zoom in"
                >
                  +
                </button>
              </Tooltip>
            </div>

            {onToggleGraphEditor && (
              <Tooltip label="Graph editor" shortcut="G">
                <button
                  type="button"
                  className={`timeline-panel__toggle-btn ${graphEditorVisible ? 'timeline-panel__toggle-btn--active' : ''}`}
                  onClick={onToggleGraphEditor}
                  aria-label="Toggle graph editor"
                  aria-pressed={graphEditorVisible}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    role="img"
                    aria-label="Graph editor"
                  >
                    <title>Graph editor</title>
                    <path d="M1 13 C4 4, 10 10, 13 1" />
                  </svg>
                </button>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </PanelDragHandle>

      {!activeTimeline ? (
        <div className="timeline-panel__empty">
          <span>No timeline selected</span>
          {onCreateTimeline && timelineIds.length === 0 && (
            <button
              type="button"
              className="timeline-panel__create-btn timeline-panel__create-btn--primary"
              aria-label="Create timeline"
              data-testid="timeline-create-empty"
              onClick={onCreateTimeline}
            >
              Create timeline
            </button>
          )}
        </div>
      ) : (
        <>
          <PlaybackControls
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            speed={playbackSpeed}
            loop={loop}
            autoKeyframe={autoKeyframe}
            onionSkin={onionSkin}
            onPlay={onPlay}
            onPause={onPause}
            onStop={onStop}
            onStepForward={handleStepForward}
            onStepBackward={handleStepBackward}
            onSeek={onSeek}
            onSpeedChange={onSpeedChange}
            onToggleLoop={onToggleLoop}
            onToggleOnionSkin={onToggleOnionSkin}
            onToggleAutoKeyframe={onToggleAutoKeyframe}
            onSavePreset={onSavePreset}
            presetOptions={presetOptions}
            onApplyPreset={onApplyPreset}
          />

          {mediaStrip}

          <div className="timeline-panel__ruler-container">
            <TimelineRuler
              duration={duration}
              currentTime={currentTime}
              zoom={zoom}
              onSeek={onSeek}
              markers={activeTimeline?.markers}
              onAddMarker={onAddMarker}
              onRenameMarker={onRenameMarker}
              onDeleteMarker={onDeleteMarker}
            />
          </div>

          <ul className="timeline-panel__tracks" ref={tracksContainerRef}>
            {tracks.length === 0 ? (
              <li className="timeline-panel__empty-tracks">No tracks in this timeline</li>
            ) : (
              tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  nodeName={getNodeName?.(track.nodeId) ?? track.nodeId}
                  duration={duration}
                  zoom={zoom}
                  selected={selectedTrackIds.includes(track.id)}
                  selectedKeyframeIndex={
                    selectedKeyframe?.trackId === track.id ? selectedKeyframe.index : null
                  }
                  timelines={timelines}
                  activeTimelineId={activeTimelineId}
                  onSelectTrack={onSelectTrack}
                  onClickKeyframe={onClickKeyframe}
                  onSetNestedTimeline={onSetTrackNestedTimeline}
                  onDeleteKeyframe={
                    onDeleteKeyframe && activeTimelineId
                      ? (progress) => onDeleteKeyframe(activeTimelineId, track.id, progress)
                      : undefined
                  }
                  onMoveKeyframe={
                    onMoveKeyframe && activeTimelineId
                      ? (oldProgress, newProgress) =>
                          onMoveKeyframe(activeTimelineId, track.id, oldProgress, newProgress)
                      : undefined
                  }
                  onSetMuted={
                    onSetTrackMuted && activeTimelineId
                      ? (muted) => onSetTrackMuted(activeTimelineId, track.id, muted)
                      : undefined
                  }
                  onSetSolo={
                    onSetTrackSolo && activeTimelineId
                      ? (solo) => onSetTrackSolo(activeTimelineId, track.id, solo)
                      : undefined
                  }
                />
              ))
            )}
          </ul>

          {graphEditorVisible && activeTimelineId && (
            <GraphEditor
              timeline={activeTimeline}
              tracks={tracks}
              selectedTrackIds={selectedTrackIds}
              currentTime={currentTime}
              duration={duration}
              onSeek={onSeek}
              onMoveKeyframe={onMoveKeyframe}
              onUpdateEasing={onUpdateKeyframeEasing}
            />
          )}
        </>
      )}
    </div>
  );
};
