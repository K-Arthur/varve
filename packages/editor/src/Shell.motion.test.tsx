import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelinePanel } from './timeline/TimelinePanel';

describe('TimelinePanel rendering', () => {
  it('renders empty state when no timeline is active', () => {
    render(
      <TimelinePanel
        timelines={{}}
        activeTimelineId={null}
        currentTime={0}
        isPlaying={false}
        playbackSpeed={1}
        loop={false}
        autoKeyframe={false}
        motionPresets={{}}
        selectedTrackIds={[]}
        selectedKeyframeIndex={null}
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
        onSeek={() => {}}
        onSpeedChange={() => {}}
        onToggleLoop={() => {}}
        onToggleAutoKeyframe={() => {}}
        onAddMarker={() => {}}
        onSelectTimeline={() => {}}
        onCreateTimeline={() => {}}
        onSelectTrack={() => {}}
        onClickKeyframe={() => {}}
        onRenameTimeline={() => {}}
        onRemoveTimeline={() => {}}
        onAddTrack={() => {}}
        onRemoveTrack={() => {}}
        onAddKeyframe={() => {}}
        onRemoveKeyframe={() => {}}
        onEditKeyframeValue={() => {}}
        onToggleKeyframeInterpolation={() => {}}
        onCopyKeyframe={() => {}}
        onPasteKeyframe={() => {}}
        onSavePreset={() => ''}
        onApplyPreset={() => {}}
        onDragKeyframe={() => {}}
        onDragTimelineHandle={() => {}}
        onMarkerChange={() => {}}
        onRemoveMarker={() => {}}
      />,
    );

    expect(screen.getByText('No timeline selected')).toBeTruthy();
    expect(screen.getByTestId('timeline-create-empty')).toBeTruthy();
  });
});
