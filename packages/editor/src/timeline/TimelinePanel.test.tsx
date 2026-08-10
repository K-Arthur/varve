import { fireEvent, render, screen } from '@testing-library/react';
import type { Timeline } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  size: vi.fn(),
}));

import { formatTime } from './PlaybackControls';
import { TimelinePanel } from './TimelinePanel';

function makeTimeline(
  id: string,
  name: string,
  duration: number,
  tracks?: import('@varve/scene').AnimationTrack[],
): Timeline {
  return {
    id,
    name,
    duration,
    tracks: tracks ?? [],
    defaultEasing: { kind: 'easeInOut' as const },
    defaultFillMode: 'none',
    defaultPlaybackDirection: 'normal',
    defaultIterations: 1,
    autoReverse: false,
  };
}

describe('TimelinePanel', () => {
  const defaultProps = {
    timelines: {},
    activeTimelineId: null,
    currentTime: 1500,
    isPlaying: false,
    playbackSpeed: 1,
    loop: false,
    selectedTrackIds: [] as string[],
    selectedKeyframe: null as { trackId: string; index: number } | null,
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onStop: vi.fn(),
    onSeek: vi.fn(),
    onSpeedChange: vi.fn(),
    onToggleLoop: vi.fn(),
    onSelectTimeline: vi.fn(),
    onSelectTrack: vi.fn(),
    onClickKeyframe: vi.fn(),
  };

  it('renders empty state "No timeline selected" when activeTimelineId is null', () => {
    render(<TimelinePanel {...defaultProps} />);
    expect(screen.getByText('No timeline selected')).toBeTruthy();
  });

  it('renders timeline selector when timelines exist', () => {
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Anim 1', 5000),
      'tl-2': makeTimeline('tl-2', 'Anim 2', 3000),
    };
    render(<TimelinePanel {...defaultProps} timelines={timelines} />);
    expect(screen.getByLabelText('Select timeline')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Select timeline'));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3); // placeholder + 2 timelines
    expect(options[1]).toHaveTextContent('Anim 1');
    expect(options[2]).toHaveTextContent('Anim 2');
  });

  it('renders playback controls with correct time from currentTime prop', () => {
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Test', 10000),
    };
    render(
      <TimelinePanel
        {...defaultProps}
        timelines={timelines}
        activeTimelineId="tl-1"
        currentTime={1500}
      />,
    );
    expect(screen.getByText('00:01.500')).toBeTruthy();
    expect(screen.getByText('00:10.000')).toBeTruthy();
  });

  it('shows "No tracks in this timeline" when timeline has no tracks', () => {
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Empty', 5000),
    };
    render(<TimelinePanel {...defaultProps} timelines={timelines} activeTimelineId="tl-1" />);
    expect(screen.getByText('No tracks in this timeline')).toBeTruthy();
  });

  it('renders track rows when timeline has tracks', () => {
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Test', 5000, [
        {
          id: 'tr-1',
          nodeId: 'n1',
          property: 'opacity',
          keyframes: [
            { progress: 0, value: 0, easing: undefined },
            { progress: 1, value: 1, easing: undefined },
          ],
          enabled: true,
          interpolation: 'linear',
        },
        {
          id: 'tr-2',
          nodeId: 'n2',
          property: 'rotation',
          keyframes: [
            { progress: 0, value: 0, easing: undefined },
            { progress: 0.5, value: 180, easing: undefined },
            { progress: 1, value: 360, easing: undefined },
          ],
          enabled: true,
          interpolation: 'linear',
        },
      ]),
    };
    render(
      <TimelinePanel
        {...defaultProps}
        timelines={timelines}
        activeTimelineId="tl-1"
        getNodeName={(id) => (id === 'n1' ? 'Rectangle' : 'Circle')}
      />,
    );
    expect(screen.getByText('Rectangle')).toBeTruthy();
    expect(screen.getByText('Circle')).toBeTruthy();
    expect(screen.getByText('opacity')).toBeTruthy();
    expect(screen.getByText('rotation')).toBeTruthy();
  });

  it('calls onPlay when play button clicked', () => {
    const onPlay = vi.fn();
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Test', 5000),
    };
    render(
      <TimelinePanel
        {...defaultProps}
        timelines={timelines}
        activeTimelineId="tl-1"
        onPlay={onPlay}
      />,
    );
    const playBtn = screen.getByLabelText('Play');
    fireEvent.click(playBtn);
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('calls onPause when pause button clicked (when playing)', () => {
    const onPause = vi.fn();
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Test', 5000),
    };
    render(
      <TimelinePanel
        {...defaultProps}
        timelines={timelines}
        activeTimelineId="tl-1"
        isPlaying={true}
        onPause={onPause}
      />,
    );
    const pauseBtn = screen.getByLabelText('Pause');
    fireEvent.click(pauseBtn);
    expect(onPause).toHaveBeenCalledOnce();
  });

  it('calls onSeek when ruler is clicked', () => {
    const onSeek = vi.fn();
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Test', 10000),
    };
    const { container } = render(
      <TimelinePanel
        {...defaultProps}
        timelines={timelines}
        activeTimelineId="tl-1"
        onSeek={onSeek}
      />,
    );
    const ruler = container.querySelector('.timeline-ruler');
    expect(ruler).toBeTruthy();
    if (ruler) {
      const rect = ruler.getBoundingClientRect();
      fireEvent.mouseDown(ruler, { clientX: rect.left + 100, clientY: rect.top + 5 });
      expect(onSeek).toHaveBeenCalled();
      const calledWith = onSeek.mock.calls[0]?.[0] as number;
      expect(calledWith).toBeGreaterThanOrEqual(0);
    }
  });

  it('calls onSelectTimeline when selector changes', () => {
    const onSelectTimeline = vi.fn();
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Anim', 5000),
    };
    render(
      <TimelinePanel
        {...defaultProps}
        timelines={timelines}
        activeTimelineId="tl-1"
        onSelectTimeline={onSelectTimeline}
      />,
    );
    fireEvent.click(screen.getByLabelText('Select timeline'));
    fireEvent.click(screen.getByRole('option', { name: /no timeline/i }));
    expect(onSelectTimeline).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByLabelText('Select timeline'));
    fireEvent.click(screen.getByRole('option', { name: /anim/i }));
    expect(onSelectTimeline).toHaveBeenCalledWith('tl-1');
  });

  it('formatTime helper works correctly', () => {
    expect(formatTime(0)).toBe('00:00.000');
    expect(formatTime(1500)).toBe('00:01.500');
    expect(formatTime(60000)).toBe('01:00.000');
    expect(formatTime(61000)).toBe('01:01.000');
    expect(formatTime(123456)).toBe('02:03.456');
    expect(formatTime(-100)).toBe('00:00.000');
  });

  it('save and apply preset controls call handlers', () => {
    const onSavePreset = vi.fn();
    const onApplyPreset = vi.fn();
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Test', 5000),
    };
    render(
      <TimelinePanel
        {...defaultProps}
        timelines={timelines}
        activeTimelineId="tl-1"
        motionPresets={{ p1: { id: 'p1', name: 'Fade In' } }}
        onSavePreset={onSavePreset}
        onApplyPreset={onApplyPreset}
      />,
    );
    fireEvent.click(screen.getByLabelText('Save timeline as motion preset'));
    expect(onSavePreset).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Apply motion preset'));
    fireEvent.click(screen.getByRole('option', { name: /fade in/i }));
    expect(onApplyPreset).toHaveBeenCalledWith('p1');
  });

  it('auto-keyframe toggle calls handler', () => {
    const onToggleAutoKeyframe = vi.fn();
    const timelines: Record<string, Timeline> = {
      'tl-1': makeTimeline('tl-1', 'Test', 5000),
    };
    render(
      <TimelinePanel
        {...defaultProps}
        timelines={timelines}
        activeTimelineId="tl-1"
        onToggleAutoKeyframe={onToggleAutoKeyframe}
      />,
    );
    fireEvent.click(screen.getByLabelText('Enable auto-keyframe'));
    expect(onToggleAutoKeyframe).toHaveBeenCalledOnce();
  });
});
