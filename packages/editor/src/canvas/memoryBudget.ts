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
  thumbnailCacheEntries: number;
  engineNodeMemoEntries: number;
}

export const DEFAULT_MEMORY_BUDGETS: MemoryBudgets = {
  subtreeIrCacheBytes: 50 * 1024 * 1024,
  transformCacheEntries: 10000,
  backdropCacheEntries: 20,
  gradientCacheEntries: 200,
  workerImageBitmaps: 10,
  thumbnailCacheEntries: 200,
  engineNodeMemoEntries: 20000,
};

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
      };
    default:
      return DEFAULT_MEMORY_BUDGETS;
  }
}
