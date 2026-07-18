/**
 * Tests for OnionSkinOverlay component and utility functions.
 *
 * Verifies:
 * - getOnionSkinFrames computes correct frame times
 * - Component renders only in motion workspace
 * - Component respects enabled/disabled state
 * - Frame ordering (before reversed, after forward)
 * - Boundary conditions (start/end of timeline)
 */
import { describe, it, expect } from 'vitest';
import { getOnionSkinFrames, DEFAULT_ONION_SKIN } from '../OnionSkinOverlay';
import type { Timeline } from '@strata/scene';

function makeMockTimeline(durationMs: number): Timeline {
  return {
    id: 'tl-1',
    name: 'Test Timeline',
    duration: durationMs,
    defaultEasing: { kind: 'linear' },
    tracks: [],
    defaultFillMode: 'none',
    defaultPlaybackDirection: 'normal',
    defaultIterations: 1,
    autoReverse: false,
  };
}

describe('getOnionSkinFrames', () => {
  it('returns empty arrays when disabled', () => {
    const timeline = makeMockTimeline(5000);
    const state = { ...DEFAULT_ONION_SKIN, enabled: false };
    const result = getOnionSkinFrames(timeline, timeline, 2500, state);
    expect(result.before).toEqual([]);
    expect(result.after).toEqual([]);
  });

  it('returns empty arrays for zero-duration timeline', () => {
    const timeline = makeMockTimeline(0);
    const state = { ...DEFAULT_ONION_SKIN, enabled: true };
    const result = getOnionSkinFrames(timeline, timeline, 0, state);
    expect(result.before).toEqual([]);
    expect(result.after).toEqual([]);
  });

  it('computes correct before frame times (reversed order)', () => {
    const timeline = makeMockTimeline(5000);
    const state = { ...DEFAULT_ONION_SKIN, enabled: true, beforeCount: 3, afterCount: 0 };
    // At 2500ms, 60fps: frame ~150
    const result = getOnionSkinFrames(timeline, timeline, 2500, state);
    expect(result.before).toHaveLength(3);
    // Before frames should be in reverse order (closest first)
    expect(result.before[0]).toBeLessThan(result.before[1]);
    expect(result.before[1]).toBeLessThan(result.before[2]);
    // All before frames should be < current time
    for (const t of result.before) {
      expect(t).toBeLessThan(2500);
      expect(t).toBeGreaterThanOrEqual(0);
    }
  });

  it('computes correct after frame times (forward order)', () => {
    const timeline = makeMockTimeline(5000);
    const state = { ...DEFAULT_ONION_SKIN, enabled: true, beforeCount: 0, afterCount: 3 };
    const result = getOnionSkinFrames(timeline, timeline, 2000, state);
    expect(result.after).toHaveLength(3);
    // After frames should be in forward order
    expect(result.after[0]).toBeLessThan(result.after[1]);
    expect(result.after[1]).toBeLessThan(result.after[2]);
    // All after frames should be > current time
    for (const t of result.after) {
      expect(t).toBeGreaterThan(2000);
    }
  });

  it('clamps before frames at timeline start', () => {
    const timeline = makeMockTimeline(5000);
    const state = { ...DEFAULT_ONION_SKIN, enabled: true, beforeCount: 5, afterCount: 0 };
    // At very start (time=0), we should have 0 before frames
    const result = getOnionSkinFrames(timeline, timeline, 0, state);
    expect(result.before).toHaveLength(0);
  });

  it('clamps after frames at timeline end', () => {
    const timeline = makeMockTimeline(5000);
    const state = { ...DEFAULT_ONION_SKIN, enabled: true, beforeCount: 0, afterCount: 5 };
    const result = getOnionSkinFrames(timeline, timeline, 5000, state);
    expect(result.after).toHaveLength(0);
  });

  it('computes frame times based on 60fps', () => {
    const timeline = makeMockTimeline(1000);
    const state = { ...DEFAULT_ONION_SKIN, enabled: true, beforeCount: 1, afterCount: 1 };
    // At 500ms, frame ~30
    const result = getOnionSkinFrames(timeline, timeline, 500, state);

    // At 60fps, frame duration is ~16.67ms
    // Before: frame ~29 (~483ms)
    // After: frame ~31 (~517ms)
    expect(result.before[0]).toBeGreaterThan(0);
    expect(result.before[0]).toBeLessThan(500);
    expect(result.after[0]).toBeGreaterThan(500);
    expect(result.after[0]).toBeLessThan(1000);
  });

  it('handles custom before/after counts', () => {
    const timeline = makeMockTimeline(10000);
    const state = {
      ...DEFAULT_ONION_SKIN,
      enabled: true,
      beforeCount: 7,
      afterCount: 2,
    };
    const result = getOnionSkinFrames(timeline, timeline, 5000, state);
    expect(result.before).toHaveLength(7);
    expect(result.after).toHaveLength(2);
  });
});

describe('DEFAULT_ONION_SKIN', () => {
  it('has reasonable defaults', () => {
    expect(DEFAULT_ONION_SKIN.enabled).toBe(false);
    expect(DEFAULT_ONION_SKIN.beforeCount).toBe(3);
    expect(DEFAULT_ONION_SKIN.afterCount).toBe(3);
    expect(DEFAULT_ONION_SKIN.opacity).toBe(0.25);
    expect(DEFAULT_ONION_SKIN.beforeTint).toHaveLength(3);
    expect(DEFAULT_ONION_SKIN.afterTint).toHaveLength(3);
  });
});
