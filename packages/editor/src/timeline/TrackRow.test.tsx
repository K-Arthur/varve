import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackRow } from './TrackRow';

function makeTrack(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    nodeId: 'n1',
    property: 'opacity',
    enabled: true,
    keyframes: [
      { progress: 0, value: 0, easing: { kind: 'linear' as const } },
      { progress: 0.5, value: 1, easing: { kind: 'linear' as const } },
      { progress: 1, value: 0.5, easing: { kind: 'linear' as const } },
    ],
    ...overrides,
  };
}

const defaultProps = {
  track: makeTrack(),
  nodeName: 'Rectangle 1',
  duration: 5000,
  zoom: 1,
  selected: false,
  selectedKeyframeIndex: null,
  timelines: {},
  activeTimelineId: null,
  onSelectTrack: vi.fn(),
  onClickKeyframe: vi.fn(),
};

describe('TrackRow', () => {
  describe('dense keyframe rendering', () => {
    it('renders without crashing', () => {
      const { container } = render(<TrackRow {...defaultProps} />);
      expect(container.querySelector('.timeline-track-row')).toBeTruthy();
    });
  });

  describe('keyboard interaction', () => {
    it('calls onSelectTrack on Enter', () => {
      const onSelectTrack = vi.fn();
      const { container } = render(<TrackRow {...defaultProps} onSelectTrack={onSelectTrack} />);
      const row = container.querySelector('.timeline-track-row')!;
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(onSelectTrack).toHaveBeenCalledWith('t1');
    });
  });
});
