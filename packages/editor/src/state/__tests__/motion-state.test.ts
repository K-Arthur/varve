/**
 * Tests for motion state creation and onion skin defaults.
 */
import { describe, it, expect } from 'vitest';
import { createInitialMotionState } from '../motion-state';

describe('createInitialMotionState', () => {
  it('returns a valid motion state', () => {
    const state = createInitialMotionState();
    expect(state).toBeDefined();
    expect(state.currentTime).toBe(0);
    expect(state.isPlaying).toBe(false);
    expect(state.activeTimelineId).toBeNull();
    expect(state.selectedTrackIds).toEqual([]);
    expect(state.selectedKeyframeIds).toEqual([]);
    expect(state.playbackSpeed).toBe(1);
    expect(state.loop).toBe(false);
    expect(state.autoKeyframe).toBe(false);
  });

  it('includes onion skin defaults', () => {
    const state = createInitialMotionState();
    expect(state.onionSkinEnabled).toBe(false);
    expect(state.onionSkinBeforeCount).toBe(3);
    expect(state.onionSkinAfterCount).toBe(3);
    expect(state.onionSkinOpacity).toBe(0.25);
  });

  it('creates independent states', () => {
    const s1 = createInitialMotionState();
    const s2 = createInitialMotionState();

    s1.currentTime = 100;
    s1.isPlaying = true;
    s1.onionSkinEnabled = true;

    expect(s2.currentTime).toBe(0);
    expect(s2.isPlaying).toBe(false);
    expect(s2.onionSkinEnabled).toBe(false);
  });
});
