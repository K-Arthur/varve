/**
 * Per-cache memory budget configuration.
 *
 * Values are approximate defaults and can be overridden via EditorSettings.
 * The byte budgets govern LRU eviction in SubtreeIrCache; the entry budgets
 * govern companion caches (backdrop blur, gradient, thumbnail, image).
 */

export interface MemoryBudgets {
  subtreeIrCacheBytes: number;
  transformCacheEntries: number;
  backdropCacheEntries: number;
  gradientCacheEntries: number;
  workerImageBitmaps: number;
  /** Byte budget for main-thread-visible bitmaps in the render-worker pipeline. */
  workerBitmapBytes: number;
  thumbnailCacheEntries: number;
  engineNodeMemoEntries: number;
  imageCacheBytes: number;
}

export const DEFAULT_MEMORY_BUDGETS: MemoryBudgets = {
  subtreeIrCacheBytes: 50 * 1024 * 1024,
  transformCacheEntries: 10000,
  backdropCacheEntries: 20,
  gradientCacheEntries: 200,
  workerImageBitmaps: 10,
  workerBitmapBytes: 128 * 1024 * 1024,
  thumbnailCacheEntries: 200,
  engineNodeMemoEntries: 20000,
  imageCacheBytes: 256 * 1024 * 1024,
};

export interface AdaptiveCacheLimits {
  subtreeIrCacheBytes: number;
  engineNodeMemoEntries: number;
}

/**
 * Derive temporary adaptive cache limits without exceeding the user's
 * configured memory preset. Recomputing this for every tier transition also
 * restores the configured limits after a constrained/performance episode.
 */
export function getAdaptiveCacheLimits(
  budgets: MemoryBudgets,
  cacheMultiplier: number,
): AdaptiveCacheLimits {
  const finiteMultiplier = Number.isFinite(cacheMultiplier) ? cacheMultiplier : 1;
  const boundedMultiplier = Math.min(1, Math.max(0, finiteMultiplier));
  return {
    subtreeIrCacheBytes: Math.max(
      1024 * 1024,
      Math.round(budgets.subtreeIrCacheBytes * boundedMultiplier),
    ),
    engineNodeMemoEntries: Math.max(
      1,
      Math.round(budgets.engineNodeMemoEntries * boundedMultiplier),
    ),
  };
}

export function getMemoryBudgets(memoryBudget?: 'low' | 'medium' | 'high'): MemoryBudgets {
  if (!memoryBudget) return DEFAULT_MEMORY_BUDGETS;
  switch (memoryBudget) {
    case 'low':
      return {
        ...DEFAULT_MEMORY_BUDGETS,
        subtreeIrCacheBytes: 10 * 1024 * 1024,
        backdropCacheEntries: 5,
        transformCacheEntries: 2000,
        engineNodeMemoEntries: 4000,
        workerBitmapBytes: 64 * 1024 * 1024,
        imageCacheBytes: 64 * 1024 * 1024,
      };
    case 'medium':
      return {
        ...DEFAULT_MEMORY_BUDGETS,
        subtreeIrCacheBytes: 25 * 1024 * 1024,
      };
    case 'high':
      return {
        ...DEFAULT_MEMORY_BUDGETS,
        subtreeIrCacheBytes: 200 * 1024 * 1024,
        imageCacheBytes: 512 * 1024 * 1024,
      };
    default:
      return DEFAULT_MEMORY_BUDGETS;
  }
}

/**
 * Deterministic low-memory pressure profiles for testing and the low-memory
 * test mode. These are NOT claims about exact OS memory behavior — they are
 * application-level pressure fixtures that tighten every byte/entry budget so
 * admission control, eviction and degradation paths are exercised
 * reproducibly. 'normal' restores the defaults.
 */
export type PressureProfile = 'normal' | '4gb' | '2gb';

export function resolvePressureBudgets(profile: PressureProfile): MemoryBudgets {
  switch (profile) {
    case '2gb':
      return {
        ...DEFAULT_MEMORY_BUDGETS,
        subtreeIrCacheBytes: 8 * 1024 * 1024,
        workerBitmapBytes: 32 * 1024 * 1024,
        imageCacheBytes: 32 * 1024 * 1024,
        backdropCacheEntries: 3,
        gradientCacheEntries: 50,
        engineNodeMemoEntries: 2000,
        transformCacheEntries: 1000,
        thumbnailCacheEntries: 50,
      };
    case '4gb':
      return {
        ...DEFAULT_MEMORY_BUDGETS,
        subtreeIrCacheBytes: 16 * 1024 * 1024,
        workerBitmapBytes: 64 * 1024 * 1024,
        imageCacheBytes: 64 * 1024 * 1024,
        backdropCacheEntries: 5,
        gradientCacheEntries: 100,
        engineNodeMemoEntries: 5000,
        transformCacheEntries: 2000,
        thumbnailCacheEntries: 100,
      };
    default:
      return DEFAULT_MEMORY_BUDGETS;
  }
}

/**
 * Resolve the runtime pressure profile from platform memory hints
 * (navigator.deviceMemory, quantized to powers of two by Chromium). This
 * wires the previously test-only pressure fixtures (finding F6) into
 * production: constrained machines get the tightened budgets, and the
 * raster pyramid residency follows the same curve as every other cache.
 * Deterministic: unknown/absent deviceMemory resolves to 'normal'.
 */
export function resolveRuntimePressureProfile(): PressureProfile {
  if (typeof navigator === 'undefined') return 'normal';
  const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (typeof deviceMemory !== 'number' || !Number.isFinite(deviceMemory)) return 'normal';
  if (deviceMemory <= 2) return '2gb';
  if (deviceMemory <= 4) return '4gb';
  return 'normal';
}
