/**
 * Adaptive performance profile — adjusts renderer settings based on frame
 * timing history, document complexity, and platform capabilities.
 *
 * Profiles govern safe performance parameters such as cache budgets,
 * prefetch depth, tessellation quality, image decode resolution,
 * effect-preview resolution, background task concurrency, batching
 * thresholds, and progressive-rendering behaviour.
 *
 * Profile transitions use hysteresis to prevent oscillation: the profile
 * must remain in the new tier for a minimum observation window before
 * switching. A cooldown period prevents rapid re-evaluation.
 */

import { probeOffscreenCapability } from '../render/offscreenCapabilityProbe';
import { resolveWorkerEligibility } from '../render/workerEligibility';

export type ProfileTier = 'quality' | 'balanced' | 'performance' | 'constrained';

export interface PerformanceProfile {
  tier: ProfileTier;
  /**
   * Interactive preview render scale. Applied to the content canvas backing
   * store only while an editor interaction (drag/pinch/wheel burst) is open;
   * settled frames and exports always render at full device resolution.
   */
  renderScale: number;
  cacheMultiplier: number;
  enableWorker: boolean;
  enablePartialRedraw: boolean;
}

/**
 * Runtime consumers, so a field is never added without one:
 * - `renderScale`: `renderPipeline.renderContent` preview DPR while interacting.
 * - `cacheMultiplier`: `getAdaptiveCacheLimits` -> subtree IR / engine-node memo.
 * - `enableWorker`: worker-paint gate in `renderPipeline`.
 * - `enablePartialRedraw`: dirty-prune gate in `renderPipeline`.
 * Image LOD, effect previewing, culling and the compositor choice are already
 * governed by their own authorities (`selectRasterRepresentation`,
 * `workerSourceCapFor`, the spatial index, ADR-0003) and deliberately do not
 * duplicate those decisions here.
 */
export const TIER_RENDER_SCALE: Readonly<Record<ProfileTier, number>> = {
  quality: 1,
  balanced: 1,
  performance: 0.75,
  constrained: 0.5,
};

export interface PlatformCapabilities {
  hasWorker: boolean;
  isWebKitGTK: boolean;
  hasWebGL: boolean;
  hasWebGPU: boolean;
  /** Explicit OffscreenCanvas support (WebKitGTK is unreliable across point releases). */
  hasOffscreenCanvas: boolean;
  /** Explicit createImageBitmap support. */
  hasCreateImageBitmap: boolean;
  /** Rendered engine family. */
  engine: 'webkit' | 'chromium' | 'gecko' | 'unknown';
  /** WebKit version string when the engine is WebKit, else undefined. */
  webKitVersion?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/** Minimum observation window in frames before a profile transition. */
const OBSERVATION_WINDOW = 10;
let COOLDOWN_FRAMES = 30;

/** Override cooldown for testing. */
export function _setCooldownFrames(n: number): void {
  COOLDOWN_FRAMES = n;
}

let currentTier: ProfileTier = 'balanced';
let framesInTier = 0;
let totalFrames = 0;

/**
 * Probe for WebGL support.
 *
 * Acquiring a WebGL context allocates a real GPU context. Browsers cap how
 * many may be live at once (Chromium ~16) and force-lose the oldest when the
 * cap is exceeded, logging "Too many active WebGL contexts". The probe context
 * is therefore released explicitly rather than left to GC.
 */
function probeWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  const gl = document.createElement('canvas').getContext('webgl');
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

/**
 * Cached capability detection. Capabilities are fixed for the lifetime of the
 * page, and `detectPlatformCapabilities` is reached from `computeProfile`,
 * which runs once per rendered frame — detecting on every call created (and
 * leaked) a canvas plus a WebGL context per frame. Mirrors the cache-once
 * pattern already used by `tools/inputNormalizer.ts`.
 */
let cachedCapabilities: PlatformCapabilities | null = null;

/** Detect platform capabilities. Computed once, then cached for the session. */
export function detectPlatformCapabilities(): PlatformCapabilities {
  if (cachedCapabilities) return cachedCapabilities;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isWebKitGTK = ua.includes('WebKit') && !ua.includes('Chrome') && !ua.includes('Mac');
  const engine: PlatformCapabilities['engine'] = isWebKitGTK
    ? 'webkit'
    : ua.includes('Chrome') || ua.includes('Chromium')
      ? 'chromium'
      : ua.includes('Firefox')
        ? 'gecko'
        : 'unknown';
  const webKitMatch = ua.match(/AppleWebKit\/(\d+(?:\.\d+)*)/);
  cachedCapabilities = {
    hasWorker: typeof Worker !== 'undefined',
    isWebKitGTK,
    hasWebGL: probeWebGL(),
    hasWebGPU: typeof navigator !== 'undefined' && 'gpu' in navigator,
    hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    hasCreateImageBitmap: typeof createImageBitmap === 'function',
    engine,
    webKitVersion: webKitMatch ? webKitMatch[1] : undefined,
    deviceMemory:
      typeof navigator !== 'undefined'
        ? (navigator as unknown as { deviceMemory?: number }).deviceMemory
        : undefined,
    hardwareConcurrency:
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
  };

  // Engines whose worker eligibility depends on verified capability start the
  // probe here, once, on the first capability read. It is a single disposable
  // worker and one 8x8 round trip; until it resolves, eligibility reports
  // `offscreen-unverified` and the conservative main-thread path is used.
  if (
    cachedCapabilities.isWebKitGTK &&
    cachedCapabilities.hasWorker &&
    cachedCapabilities.hasOffscreenCanvas
  ) {
    void probeOffscreenCapability();
  }

  return cachedCapabilities;
}

/** Clear cached capability detection. Test seam for environment changes. */
export function _resetPlatformCapabilities(): void {
  cachedCapabilities = null;
}

function selectTier(
  avgFrameTime: number,
  overBudgetCount: number,
  _nodeCount: number,
  _caps: PlatformCapabilities,
): ProfileTier {
  const budget = 1000 / 60;

  if (overBudgetCount >= OBSERVATION_WINDOW * 0.8 || avgFrameTime > budget * 2.5) {
    return 'constrained';
  }
  if (overBudgetCount >= OBSERVATION_WINDOW * 0.5 || avgFrameTime > budget * 1.5) {
    return 'performance';
  }
  if (overBudgetCount >= OBSERVATION_WINDOW * 0.2 || avgFrameTime > budget) {
    return 'balanced';
  }
  return 'quality';
}

function profileForTier(tier: ProfileTier, caps: PlatformCapabilities): PerformanceProfile {
  switch (tier) {
    case 'quality':
      return {
        tier: 'quality',
        renderScale: TIER_RENDER_SCALE.quality,
        cacheMultiplier: 2,
        enableWorker: resolveWorkerEligibility(caps).allowed,
        enablePartialRedraw: true,
      };
    case 'balanced':
      return {
        tier: 'balanced',
        renderScale: TIER_RENDER_SCALE.balanced,
        cacheMultiplier: 1,
        enableWorker: resolveWorkerEligibility(caps).allowed,
        enablePartialRedraw: true,
      };
    case 'performance':
      return {
        tier: 'performance',
        renderScale: TIER_RENDER_SCALE.performance,
        cacheMultiplier: 0.5,
        enableWorker: false,
        enablePartialRedraw: true,
      };
    case 'constrained':
      return {
        tier: 'constrained',
        renderScale: TIER_RENDER_SCALE.constrained,
        cacheMultiplier: 0.25,
        enableWorker: false,
        enablePartialRedraw: false,
      };
  }
}

/**
 * Compute the adaptive profile based on recent frame timing and document
 * complexity. Uses hysteresis: the profile must remain in the new tier
 * for OBSERVATION_WINDOW frames before switching, with a cooldown period.
 */
export function computeProfile(
  avgFrameTime: number,
  overBudgetCount: number,
  nodeCount: number,
): PerformanceProfile {
  totalFrames++;
  framesInTier++;

  const caps = detectPlatformCapabilities();
  const desiredTier = selectTier(avgFrameTime, overBudgetCount, nodeCount, caps);

  if (framesInTier < COOLDOWN_FRAMES) {
    return profileForTier(currentTier, caps);
  }

  if (framesInTier >= OBSERVATION_WINDOW && desiredTier !== currentTier) {
    currentTier = desiredTier;
    framesInTier = 0;
  }

  return profileForTier(currentTier, caps);
}

/** Get current tier without re-computing. */
export function getCurrentTier(): ProfileTier {
  return currentTier;
}

/**
 * Preview render scale for the tier selected by the last frame. Read by the
 * render pipeline at the top of a frame, before the per-frame profile is
 * recomputed, so a tier change takes effect on the following frame.
 */
export function getCurrentRenderScale(): number {
  return TIER_RENDER_SCALE[currentTier];
}

/** Override the tier for tests. Resets the tier dwell counter. */
export function _setTierForTesting(tier: ProfileTier): void {
  currentTier = tier;
  framesInTier = 0;
}

/** Reset profile state (e.g. on document switch). */
export function resetProfile(): void {
  currentTier = 'balanced';
  framesInTier = 0;
  totalFrames = 0;
}

/** Total frames observed. */
export function getTotalObservedFrames(): number {
  return totalFrames;
}
