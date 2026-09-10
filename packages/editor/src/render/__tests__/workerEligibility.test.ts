/**
 * Render-worker eligibility — the gate that decides main-thread vs worker.
 *
 * The regression these tests exist to prevent is the one this module replaced:
 * a permanent per-engine ban that could never be re-evaluated as the engine
 * improved. The rules below pin both halves of the contract — that verified
 * capability is *required* on WebKitGTK, and that no other engine's behaviour
 * changed when the ban was removed.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { _resetOffscreenCapability, _setOffscreenCapability } from '../offscreenCapabilityProbe';
import { _setWebKitWorkerActivation, resolveWorkerEligibility } from '../workerEligibility';

const chromium = { hasWorker: true, hasOffscreenCanvas: true, isWebKitGTK: false };
const webkit = { hasWorker: true, hasOffscreenCanvas: true, isWebKitGTK: true };

afterEach(() => {
  _resetOffscreenCapability();
  _setWebKitWorkerActivation(null);
});

describe('resolveWorkerEligibility', () => {
  describe('engines other than WebKitGTK are unchanged', () => {
    it('allows the worker on Chromium without consulting the probe', () => {
      // Deliberately leave the capability unverified: non-WebKit engines must
      // not start depending on a probe that never runs for them.
      expect(resolveWorkerEligibility(chromium)).toEqual({ allowed: true, reason: 'none' });
    });

    it('still refuses when the platform has no Worker', () => {
      expect(resolveWorkerEligibility({ ...chromium, hasWorker: false })).toEqual({
        allowed: false,
        reason: 'worker-unavailable',
      });
    });

    it('still refuses when OffscreenCanvas is absent', () => {
      expect(resolveWorkerEligibility({ ...chromium, hasOffscreenCanvas: false })).toEqual({
        allowed: false,
        reason: 'offscreen-unavailable',
      });
    });
  });

  describe('WebKitGTK requires verified capability', () => {
    it('refuses while the probe has not resolved', () => {
      // The critical safety property: "not yet known" must never be treated as
      // support, or the first frames of every session race the probe.
      expect(resolveWorkerEligibility(webkit)).toEqual({
        allowed: false,
        reason: 'offscreen-unverified',
      });
    });

    it('refuses when the probe found a broken implementation', () => {
      _setOffscreenCapability({ capability: 'offscreen-api-present-but-broken' });
      expect(resolveWorkerEligibility(webkit)).toEqual({
        allowed: false,
        reason: 'offscreen-unavailable',
      });
    });

    it('refuses when pixels cannot be transferred back', () => {
      _setOffscreenCapability({ capability: 'offscreen-transfer-broken' });
      expect(resolveWorkerEligibility(webkit).allowed).toBe(false);
    });

    it('allows verified capability by default', () => {
      // The whole point of verifying: a WebKitGTK build that passes the probe
      // gets the worker path without anyone opting in.
      _setOffscreenCapability({ capability: 'offscreen-supported' });
      expect(resolveWorkerEligibility(webkit)).toEqual({ allowed: true, reason: 'none' });
    });

    it('honours an explicit opt-out even when verified', () => {
      // The bisecting escape hatch, attributed as a policy decision rather
      // than a capability failure.
      _setOffscreenCapability({ capability: 'offscreen-supported' });
      _setWebKitWorkerActivation(false);
      expect(resolveWorkerEligibility(webkit)).toEqual({
        allowed: false,
        reason: 'webkit-policy',
      });
    });

    it('does not let activation override a broken implementation', () => {
      // Opting in must not be a way to force a path the engine cannot run.
      _setOffscreenCapability({ capability: 'offscreen-transfer-broken' });
      _setWebKitWorkerActivation(true);
      expect(resolveWorkerEligibility(webkit).allowed).toBe(false);
    });
  });

  describe('gate ordering', () => {
    it('reports the earliest failing gate, not the last one checked', () => {
      // A WebKitGTK build with no Worker at all should say so, rather than
      // blaming the engine policy it never reached.
      _setOffscreenCapability({ capability: 'offscreen-supported' });
      _setWebKitWorkerActivation(true);
      expect(resolveWorkerEligibility({ ...webkit, hasWorker: false }).reason).toBe(
        'worker-unavailable',
      );
    });
  });
});
