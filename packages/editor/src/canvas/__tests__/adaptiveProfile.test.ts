import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetPlatformCapabilities,
  _setCooldownFrames,
  computeProfile,
  detectPlatformCapabilities,
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

describe('platform capability detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    _resetPlatformCapabilities();
  });

  it('probes the DOM only once across repeated calls', () => {
    _resetPlatformCapabilities();
    const createElement = vi.spyOn(document, 'createElement');

    const first = detectPlatformCapabilities();
    for (let i = 0; i < 50; i++) detectPlatformCapabilities();

    // The probe canvas must be created at most once, not once per call.
    expect(createElement.mock.calls.filter(([tag]) => tag === 'canvas').length).toBeLessThanOrEqual(
      1,
    );
    expect(detectPlatformCapabilities()).toBe(first);
  });

  it('does not acquire a WebGL context per rendered frame', () => {
    // Regression guard: computeProfile runs once per frame and reaches
    // detectPlatformCapabilities. Detecting per call leaked a canvas and a
    // live WebGL context every frame, and the browser force-lost the oldest
    // context once its cap was hit ("Too many active WebGL contexts").
    _resetPlatformCapabilities();
    resetProfile();
    _setCooldownFrames(5);
    const createElement = vi.spyOn(document, 'createElement');

    for (let i = 0; i < 120; i++) computeProfile(10, 0, 100);

    expect(createElement.mock.calls.filter(([tag]) => tag === 'canvas').length).toBeLessThanOrEqual(
      1,
    );
  });

  it('releases the probe context instead of holding it live', () => {
    _resetPlatformCapabilities();
    const loseContext = vi.fn();
    const gl = { getExtension: vi.fn(() => ({ loseContext })) };
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: () => gl,
    } as unknown as HTMLCanvasElement);

    expect(detectPlatformCapabilities().hasWebGL).toBe(true);
    expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});
