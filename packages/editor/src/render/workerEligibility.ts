/**
 * Render-worker eligibility — capability-gated, not user-agent-gated.
 *
 * History: the profile gate was `hasWorker && hasOffscreenCanvas &&
 * !isWebKitGTK`. The blanket engine ban existed because WebKitGTK's
 * OffscreenCanvas support was reported as unreliable across point releases,
 * and `renderWorker.ts` constructs an OffscreenCanvas unguarded on its first
 * message — on an engine without it that throws inside `onmessage`, surfaces
 * only via `onerror`, and burns five exponential-backoff restarts before
 * falling back. Banning the engine outright was the cheap safe answer.
 *
 * It is also a permanent answer to a temporary question. A UA string cannot
 * distinguish a WebKitGTK build that implements the chain from one that does
 * not, and the version it exposes is useless for this: WebKitGTK reports the
 * frozen Safari-compatibility token (`AppleWebKit/605.1.15`) regardless of the
 * real library version, so version gating would key off a constant.
 *
 * The replacement is evidence. `offscreenCapabilityProbe` runs the real chain
 * once per session in a disposable worker and reports a verified result; this
 * module turns that result, plus the engine policy, into an eligibility
 * decision with an attributable reason for every refusal.
 *
 * Verified capability establishes eligibility; `webKitWorkerActivationEnabled`
 * then decides activation, defaulting to on for a verified engine with an
 * explicit opt-out for bisecting.
 */

import { getOffscreenCapability } from './offscreenCapabilityProbe';
import type { RenderPathFallbackReason } from './renderPathDiagnostics';

/**
 * The capability fields this decision needs, declared structurally rather than
 * imported from `canvas/adaptiveProfile`. `PlatformCapabilities` satisfies it,
 * but importing that type would close an `adaptiveProfile -> workerEligibility
 * -> adaptiveProfile` loop in the module graph the architecture audit tracks.
 */
export interface WorkerCapabilityInputs {
  hasWorker: boolean;
  hasOffscreenCanvas: boolean;
  isWebKitGTK: boolean;
}

export interface WorkerEligibility {
  allowed: boolean;
  reason: RenderPathFallbackReason;
}

/**
 * Explicit activation override for engines whose worker path is verified but
 * not yet performance-validated. `null` means "no override, use the default
 * policy for this engine".
 */
let activationOverride: boolean | null = null;

/** Force WebKit worker activation on/off. Test and diagnostics seam. */
export function _setWebKitWorkerActivation(value: boolean | null): void {
  activationOverride = value;
}

/**
 * Whether the WebKit worker path is active for this session.
 *
 * Default is **on for engines whose capability was verified** — the probe
 * exercises the same chain a real frame uses (construct in worker, 2D context,
 * replay, `transferToImageBitmap`, transfer back, pixels re-verified on the
 * main thread) and WebKitGTK 2.52.5 passes every stage over 1,000 frames.
 * Keeping a verified engine on the main thread was the defect, not the
 * safeguard.
 *
 * The escape hatch is explicit rather than implicit: `?webkitWorker=0` or
 * `localStorage['varve.webkitRenderWorker'] = 'off'` forces the main-thread
 * path without a rebuild, for bisecting a suspected renderer regression on a
 * user's machine. Capability verification is NOT bypassable in either
 * direction — an engine that fails the probe never reaches this function.
 */
export function webKitWorkerActivationEnabled(): boolean {
  if (activationOverride !== null) return activationOverride;
  if (typeof window === 'undefined') return false;
  try {
    if (window.location?.search?.includes('webkitWorker=0')) return false;
    if (window.localStorage?.getItem('varve.webkitRenderWorker') === 'off') return false;
    return true;
  } catch {
    // Storage can throw in restricted contexts. The verified capability is the
    // real gate; an unreadable preference must not disable a working path.
    return true;
  }
}

/**
 * Resolve whether the render worker may be used, and why not when it may not.
 *
 * Order matters: the earliest failing gate is the reported reason, so the
 * diagnostic names the gate that actually decided rather than the last one
 * checked.
 */
export function resolveWorkerEligibility(caps: WorkerCapabilityInputs): WorkerEligibility {
  if (!caps.hasWorker) return { allowed: false, reason: 'worker-unavailable' };
  if (!caps.hasOffscreenCanvas) return { allowed: false, reason: 'offscreen-unavailable' };

  // Engines other than WebKitGTK keep their existing behaviour exactly: the
  // API presence check that has always governed them still governs them, so
  // this change cannot regress Chromium, WebView2 or WKWebView.
  if (!caps.isWebKitGTK) return { allowed: true, reason: 'none' };

  const capability = getOffscreenCapability();
  if (capability === 'offscreen-unknown') {
    // Probe not finished (or timed out). Not evidence of support.
    return { allowed: false, reason: 'offscreen-unverified' };
  }
  if (capability !== 'offscreen-supported') {
    return { allowed: false, reason: 'offscreen-unavailable' };
  }
  if (!webKitWorkerActivationEnabled()) {
    return { allowed: false, reason: 'webkit-policy' };
  }
  return { allowed: true, reason: 'none' };
}
