/**
 * Render-path diagnostics — the report must never claim a backend that is not
 * running. A wrong answer here sends the next investigation to the wrong layer.
 */

import { describe, expect, it } from 'vitest';
import {
  describeRenderPath,
  type RenderPathInputs,
  resolveRenderPathDiagnostic,
} from '../renderPathDiagnostics';

const base: RenderPathInputs = {
  engine: 'webkit',
  engineVersionToken: '605.1.15',
  hasWorker: true,
  hasOffscreenCanvas: true,
  hasWebGPU: false,
  offscreenCapability: 'offscreen-supported',
  eligibility: { allowed: false, reason: 'webkit-policy' },
  workerHostCreated: true,
  recentFramePaths: [],
};

describe('resolveRenderPathDiagnostic', () => {
  it('reports main-thread rendering with the deciding gate', () => {
    const d = resolveRenderPathDiagnostic(base);
    expect(d.actualBackend).toBe('main-canvas2d');
    expect(d.fallbackReason).toBe('webkit-policy');
    // A created host must not be mistaken for an active one: this is exactly
    // the inference that made the old diagnostics misleading.
    expect(d.workerHostCreated).toBe(true);
    expect(describeRenderPath(d)).toBe('webkit -> main-canvas2d (webkit-policy)');
  });

  it('separates API presence from verified capability', () => {
    const d = resolveRenderPathDiagnostic({
      ...base,
      offscreenCapability: 'offscreen-unknown',
      eligibility: { allowed: false, reason: 'offscreen-unverified' },
    });
    expect(d.offscreenCanvasAvailable).toBe(true);
    expect(d.offscreenCanvasVerified).toBe(false);
    expect(d.fallbackReason).toBe('offscreen-unverified');
  });

  it('believes observed frames over configuration', () => {
    // Configuration says the worker is allowed, but every observed frame was
    // drawn by the compositor: the observation wins.
    const d = resolveRenderPathDiagnostic({
      ...base,
      eligibility: { allowed: true, reason: 'none' },
      recentFramePaths: ['compositor', 'compositor', 'compositor'],
    });
    expect(d.actualBackend).toBe('main-canvas2d');
    expect(d.observedMainThreadFrames).toBe(3);
    expect(d.observedWorkerFrames).toBe(0);
  });

  it('reports the worker backend once worker frames dominate', () => {
    const d = resolveRenderPathDiagnostic({
      ...base,
      eligibility: { allowed: true, reason: 'none' },
      recentFramePaths: ['worker-cached', 'worker-cached', 'compositor'],
    });
    expect(d.actualBackend).toBe('worker-offscreen-canvas2d');
    expect(d.observedWorkerFrames).toBe(2);
  });

  it('falls back to configuration before any frame is observed', () => {
    const d = resolveRenderPathDiagnostic({
      ...base,
      eligibility: { allowed: true, reason: 'none' },
      recentFramePaths: [],
    });
    expect(d.actualBackend).toBe('worker-offscreen-canvas2d');
    expect(d.requestedBackend).toBe('worker-offscreen-canvas2d');
  });

  it('does not use the frozen WebKit token for gating', () => {
    // Recorded for provenance only. WebKitGTK reports 605.1.15 regardless of
    // the real library version, so any gate keyed on it would be a constant.
    const d = resolveRenderPathDiagnostic(base);
    expect(d.engineVersionToken).toBe('605.1.15');
    expect(d.offscreenCanvasVerified).toBe(true);
  });
});
