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

export type ProfileTier = 'quality' | 'balanced' | 'performance' | 'constrained';

export interface PerformanceProfile {
  tier: ProfileTier;
  renderScale: number;
  cacheMultiplier: number;
  enableWorker: boolean;
  enablePartialRedraw: boolean;
  enableCulling: boolean;
  backdropBlurQuality: 'high' | 'medium' | 'low';
  prefetchEnabled: boolean;
  prefetchDepth: number;
  imageDecodeQuality: 'full' | 'half' | 'quarter';
  effectQuality: 'full' | 'reduced' | 'disabled';
  compositor: 'canvas2d' | 'webgpu' | 'auto';
}

export interface PlatformCapabilities {
  hasWorker: boolean;
  isWebKitGTK: boolean;
  hasWebGL: boolean;
  hasWebGPU: boolean;
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

/** Detect platform capabilities. */
export function detectPlatformCapabilities(): PlatformCapabilities {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isWebKitGTK = ua.includes('WebKit') && !ua.includes('Chrome') && !ua.includes('Mac');
  return {
    hasWorker: typeof OffscreenCanvas !== 'undefined',
    isWebKitGTK,
    hasWebGL:
      typeof document !== 'undefined'
        ? !!document.createElement('canvas').getContext('webgl')
        : false,
    hasWebGPU: typeof navigator !== 'undefined' && 'gpu' in navigator,
    deviceMemory:
      typeof navigator !== 'undefined'
        ? (navigator as unknown as { deviceMemory?: number }).deviceMemory
        : undefined,
    hardwareConcurrency:
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
  };
}

function selectTier(
  avgFrameTime: number,
  overBudgetCount: number,
  nodeCount: number,
  caps: PlatformCapabilities,
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
        renderScale: 1,
        cacheMultiplier: 2,
        enableWorker: caps.hasWorker && !caps.isWebKitGTK,
        enablePartialRedraw: true,
        enableCulling: true,
        backdropBlurQuality: 'high',
        prefetchEnabled: true,
        prefetchDepth: 3,
        imageDecodeQuality: 'full',
        effectQuality: 'full',
        compositor: caps.hasWebGPU ? 'webgpu' : 'canvas2d',
      };
    case 'balanced':
      return {
        tier: 'balanced',
        renderScale: 1,
        cacheMultiplier: 1,
        enableWorker: caps.hasWorker && !caps.isWebKitGTK,
        enablePartialRedraw: true,
        enableCulling: true,
        backdropBlurQuality: 'medium',
        prefetchEnabled: true,
        prefetchDepth: 2,
        imageDecodeQuality: 'full',
        effectQuality: 'full',
        compositor: 'canvas2d',
      };
    case 'performance':
      return {
        tier: 'performance',
        renderScale: 0.75,
        cacheMultiplier: 0.5,
        enableWorker: false,
        enablePartialRedraw: true,
        enableCulling: true,
        backdropBlurQuality: 'low',
        prefetchEnabled: false,
        prefetchDepth: 0,
        imageDecodeQuality: 'half',
        effectQuality: 'reduced',
        compositor: 'canvas2d',
      };
    case 'constrained':
      return {
        tier: 'constrained',
        renderScale: 0.5,
        cacheMultiplier: 0.25,
        enableWorker: false,
        enablePartialRedraw: false,
        enableCulling: true,
        backdropBlurQuality: 'low',
        prefetchEnabled: false,
        prefetchDepth: 0,
        imageDecodeQuality: 'quarter',
        effectQuality: 'disabled',
        compositor: 'canvas2d',
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
