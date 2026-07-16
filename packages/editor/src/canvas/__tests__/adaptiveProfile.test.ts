import { describe, expect, it } from 'vitest';
import {
  _setCooldownFrames,
  computeProfile,
  getCurrentTier,
  resetProfile,
} from '../adaptiveProfile';

describe('adaptiveProfile', () => {
  it('starts at balanced tier', () => {
    resetProfile();
    _setCooldownFrames(5);
    expect(getCurrentTier()).toBe('balanced');
  });

  it('returns quality tier on fast frames with few nodes', () => {
    resetProfile();
    _setCooldownFrames(5);
    // Call enough times to pass cooldown + observation
    for (let i = 0; i < 20; i++) {
      const profile = computeProfile(8, 0, 50);
      if (i >= 15) {
        expect(profile.tier).toBe('quality');
        expect(profile.renderScale).toBe(1);
        expect(profile.backdropBlurQuality).toBe('high');
        expect(profile.prefetchEnabled).toBe(true);
      }
    }
  });

  it('degrades to performance on sustained slow frames', () => {
    resetProfile();
    _setCooldownFrames(5);
    for (let i = 0; i < 25; i++) {
      const profile = computeProfile(25, 15, 500);
      if (i >= 20) {
        expect(
          ['performance', 'constrained'],
          `expected performance or constrained, got ${profile.tier}`,
        ).toContain(profile.tier);
        expect(profile.renderScale).toBeLessThanOrEqual(0.75);
      }
    }
  });

  it('degrades to constrained on severe overruns', () => {
    resetProfile();
    _setCooldownFrames(5);
    for (let i = 0; i < 25; i++) {
      const profile = computeProfile(50, 18, 2000);
      if (i >= 20) {
        expect(profile.tier, `expected constrained, got ${profile.tier}`).toBe('constrained');
        expect(profile.renderScale).toBe(0.5);
        expect(profile.imageDecodeQuality).toBe('quarter');
        expect(profile.effectQuality).toBe('disabled');
      }
    }
  });

  it('profile respects cooldown before transitions', () => {
    resetProfile();
    _setCooldownFrames(10);
    // Even with bad metrics, early frames stay balanced
    for (let i = 0; i < 8; i++) {
      const profile = computeProfile(50, 10, 1000);
      expect(profile.tier).toBe('balanced');
    }
  });

  it('does not oscillate between tiers', () => {
    resetProfile();
    _setCooldownFrames(5);
    let lastTier = 'balanced';
    const transitions: string[] = [];
    for (let i = 0; i < 60; i++) {
      const metrics = i < 30 ? { avg: 25, over: 15, nodes: 500 } : { avg: 8, over: 0, nodes: 50 };
      const profile = computeProfile(metrics.avg, metrics.over, metrics.nodes);
      if (profile.tier !== lastTier) {
        transitions.push(profile.tier);
        lastTier = profile.tier;
      }
    }
    // Should have at most 2 transitions (not rapid oscillation)
    expect(transitions.length).toBeLessThanOrEqual(2);
  });
});
