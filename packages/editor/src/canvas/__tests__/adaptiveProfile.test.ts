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

  it('classifies WebKitGTK with its capability flags', () => {
    _resetPlatformCapabilities();
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15 (CachyOS)',
      configurable: true,
    });
    const caps = detectPlatformCapabilities();
    expect(caps.isWebKitGTK).toBe(true);
    expect(caps.engine).toBe('webkit');
    expect(caps.webKitVersion).toBe('605.1.15');
    expect(caps.hasOffscreenCanvas).toBe(typeof OffscreenCanvas !== 'undefined');
    expect(caps.hasCreateImageBitmap).toBe(typeof createImageBitmap === 'function');
  });

  it('classifies Chromium as a non-WebKit engine', () => {
    _resetPlatformCapabilities();
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      configurable: true,
    });
    const caps = detectPlatformCapabilities();
    expect(caps.isWebKitGTK).toBe(false);
    expect(caps.engine).toBe('chromium');
  });

  it('worker rendering requires both Worker and OffscreenCanvas', () => {
    _resetPlatformCapabilities();
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      configurable: true,
    });
    resetProfile();
    _setCooldownFrames(1);
    const profile = computeProfile(8, 0, 50);
    expect(profile.enableWorker).toBe(
      typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined',
    );
  });
});
