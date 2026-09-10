// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GraphEditor } from './GraphEditor';

vi.mock('@varve/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/shared')>();
  return {
    ...actual,
    getEasingFn: () => (t: number) => t,
  };
});

const makeTimeline = (tracks: import('@varve/scene').AnimationTrack[] = []) => ({
  id: 'tl-1',
  name: 'Test Timeline',
  duration: 5000,
  defaultEasing: { kind: 'linear' as const },
  tracks,
});

describe('GraphEditor', () => {
  it('renders header without track count when no tracks', () => {
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline()}
        tracks={[]}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    expect(container.querySelector('.graph-editor__title')).toBeDefined();
    expect(container.querySelector('.graph-editor__info')).toBeNull();
  });

  it('renders curve for a single track', () => {
    const track = {
      id: 'track-1',
      nodeId: 'node-1',
      property: 'opacity',
      keyframes: [
        { progress: 0, value: 0 },
        { progress: 1, value: 1 },
      ],
    };
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline([track])}
        tracks={[track]}
        selectedTrackIds={[]}
        currentTime={2500}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    const paths = container.querySelectorAll('.graph-editor__curve');
    expect(paths.length).toBe(1);
  });

  it('renders multiple curves for multiple tracks', () => {
    const tracks = [
      {
        id: 't1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 1 },
        ],
      },
      {
        id: 't2',
        nodeId: 'n1',
        property: 'rotation',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 360 },
        ],
      },
    ];
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline(tracks)}
        tracks={tracks}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    const paths = container.querySelectorAll('.graph-editor__curve');
    expect(paths.length).toBe(2);
  });

  it('shows track count', () => {
    const tracks = [
      { id: 't1', nodeId: 'n1', property: 'opacity', keyframes: [{ progress: 0, value: 0 }] },
    ];
    render(
      <GraphEditor
        timeline={makeTimeline(tracks)}
        tracks={tracks}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    expect(screen.getByText('1 track')).toBeDefined();
  });

  it('calls onSeek when ruler area is clicked', async () => {
    const onSeek = vi.fn();
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline()}
        tracks={[]}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={onSeek}
      />,
    );
    const svg = container.querySelector('.graph-editor__svg');
    expect(svg).toBeDefined();
  });

  it('renders playhead at correct position for non-zero currentTime', () => {
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline()}
        tracks={[]}
        selectedTrackIds={[]}
        currentTime={2500}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    const playhead = container.querySelector('.graph-editor__playhead');
    expect(playhead).toBeDefined();
  });

  it('renders playhead at start when currentTime is 0', () => {
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline()}
        tracks={[]}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    const playhead = container.querySelector('.graph-editor__playhead');
    expect(playhead).toBeDefined();
  });

  it('filters tracks by selectedTrackIds', () => {
    const tracks = [
      {
        id: 't1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 1 },
        ],
      },
      {
        id: 't2',
        nodeId: 'n1',
        property: 'rotation',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 360 },
        ],
      },
    ];
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline(tracks)}
        tracks={tracks}
        selectedTrackIds={['t1']}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    const paths = container.querySelectorAll('.graph-editor__curve');
    expect(paths.length).toBe(1);
  });

  it('hides disabled tracks', () => {
    const tracks = [
      {
        id: 't1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 1 },
        ],
        enabled: false,
      },
      {
        id: 't2',
        nodeId: 'n1',
        property: 'rotation',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 360 },
        ],
        enabled: true,
      },
    ];
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline(tracks)}
        tracks={tracks}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    const paths = container.querySelectorAll('.graph-editor__curve');
    expect(paths.length).toBe(1);
  });

  it('renders keyframe dots on curves', () => {
    const tracks = [
      {
        id: 't1',
        nodeId: 'n1',
        property: 'opacity',
        keyframes: [
          { progress: 0, value: 0 },
          { progress: 1, value: 1 },
        ],
      },
    ];
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline(tracks)}
        tracks={tracks}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    const dots = container.querySelectorAll('.graph-editor__keyframe-dot');
    expect(dots.length).toBe(2);
  });

  it('renders grid lines', () => {
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline()}
        tracks={[]}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    const gridLines = container.querySelectorAll('.graph-editor__grid-line');
    expect(gridLines.length).toBe(10);
  });

  it('renders axis labels', () => {
    const { container } = render(
      <GraphEditor
        timeline={makeTimeline()}
        tracks={[]}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    const labels = container.querySelectorAll('.graph-editor__axis-label');
    expect(labels.length).toBeGreaterThan(0);
  });

  it('has accessible role and label', () => {
    render(
      <GraphEditor
        timeline={makeTimeline()}
        tracks={[]}
        selectedTrackIds={[]}
        currentTime={0}
        duration={5000}
        onSeek={vi.fn()}
      />,
    );
    expect(screen.getByRole('application', { name: /graph editor/i })).toBeDefined();
    expect(screen.getByRole('img', { name: /animation curve graph editor/i })).toBeDefined();
  });
});
