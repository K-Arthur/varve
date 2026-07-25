/**
 * Audit Cache
 *
 * Multi-level cache for audit results with invalidation support.
 * Implements rule-level, node-level, evidence-level, and pixel-level caching.
 *
 * @module auditCache
 */

import type { AuditFinding, NodeId } from '@strata/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Cache level for different types of cached data.
 */
export type CacheLevel = 'rule' | 'node' | 'evidence' | 'pixel';

/**
 * Cached result from an audit rule.
 */
export interface CachedResult {
  /** Finding ID */
  findingId: string;

  /** Findings from this cache entry */
  findings: AuditFinding[];

  /** Timestamp when cached */
  timestamp: number;

  /** Document revision when cached */
  documentRevision: number;

  /** Node revision when cached (for node-level cache) */
  nodeRevision?: number;

  /** Evidence hash when cached (for evidence-level cache) */
  evidenceHash?: string;

  /** Image hash when cached (for pixel-level cache) */
  imageHash?: string;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  /** Total entries in cache */
  totalEntries: number;

  /** Entries by level */
  entriesByLevel: Record<CacheLevel, number>;

  /** Cache hit rate (0-1) */
  hitRate: number;

  /** Total hits */
  totalHits: number;

  /** Total misses */
  totalMisses: number;
}

/**
 * Cache validator function.
 */
export type CacheValidator = (result: CachedResult) => boolean;

// ============================================================================
// Cache Manager Class
// ============================================================================

/**
 * Multi-level cache manager for audit results.
 */
export class AuditCache {
  private ruleCache: Map<string, CachedResult> = new Map();
  private nodeCache: Map<string, CachedResult> = new Map();
  private evidenceCache: Map<string, CachedResult> = new Map();
  private pixelCache: Map<string, CachedResult> = new Map();

  private stats: {
    hits: number;
    misses: number;
  } = {
    hits: 0,
    misses: 0,
  };

  /**
   * Get cached result or null if not cached or invalid.
   *
   * @param key - Cache key
   * @param level - Cache level
   * @param validator - Validator function to check if cache is still valid
   * @returns Cached result or null
   */
  get(key: string, level: CacheLevel, validator?: CacheValidator): CachedResult | null {
    const cache = this.getCache(level);
    const result = cache.get(key);

    if (!result) {
      this.stats.misses++;
      return null;
    }

    // Validate if validator provided
    if (validator && !validator(result)) {
      cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return result;
  }

  /**
   * Set cached result.
   *
   * @param key - Cache key
   * @param level - Cache level
   * @param result - Result to cache
   */
  set(key: string, level: CacheLevel, result: CachedResult): void {
    const cache = this.getCache(level);
    cache.set(key, result);
  }

  /**
   * Invalidate all caches.
   */
  invalidateAll(): void {
    this.ruleCache.clear();
    this.nodeCache.clear();
    this.evidenceCache.clear();
    this.pixelCache.clear();
  }

  /**
   * Invalidate specific cache level.
   *
   * @param level - Cache level to invalidate
   */
  invalidateLevel(level: CacheLevel): void {
    this.getCache(level).clear();
  }

  /**
   * Invalidate specific key.
   *
   * @param key - Cache key to invalidate
   * @param level - Cache level
   */
  invalidate(key: string, level: CacheLevel): void {
    this.getCache(level).delete(key);
  }

  /**
   * Invalidate by document revision.
   *
   * @param revision - Document revision to invalidate
   */
  invalidateByDocumentRevision(revision: number): void {
    const invalidateCache = (cache: Map<string, CachedResult>) => {
      for (const [key, result] of cache.entries()) {
        if (result.documentRevision !== revision) {
          cache.delete(key);
        }
      }
    };

    invalidateCache(this.ruleCache);
    invalidateCache(this.nodeCache);
    invalidateCache(this.evidenceCache);
    invalidateCache(this.pixelCache);
  }

  /**
   * Invalidate by node revision.
   *
   * @param nodeId - Node ID
   * @param revision - Node revision to invalidate
   */
  invalidateByNodeRevision(nodeId: NodeId, revision: number): void {
    for (const [key, result] of this.nodeCache.entries()) {
      if (result.nodeRevision !== undefined && result.nodeRevision !== revision) {
        this.nodeCache.delete(key);
      }
    }
  }

  /**
   * Invalidate by evidence hash.
   *
   * @param hash - Evidence hash to invalidate
   */
  invalidateByEvidenceHash(hash: string): void {
    for (const [key, result] of this.evidenceCache.entries()) {
      if (result.evidenceHash !== hash) {
        this.evidenceCache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics.
   *
   * @returns Cache statistics
   */
  getStats(): CacheStats {
    const totalEntries =
      this.ruleCache.size + this.nodeCache.size + this.evidenceCache.size + this.pixelCache.size;

    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    return {
      totalEntries,
      entriesByLevel: {
        rule: this.ruleCache.size,
        node: this.nodeCache.size,
        evidence: this.evidenceCache.size,
        pixel: this.pixelCache.size,
      },
      hitRate,
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses,
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
    };
  }

  /**
   * Clear all caches and reset statistics.
   */
  clear(): void {
    this.invalidateAll();
    this.resetStats();
  }

  /**
   * Get cache map for level.
   *
   * @param level - Cache level
   * @returns Cache map
   */
  private getCache(level: CacheLevel): Map<string, CachedResult> {
    switch (level) {
      case 'rule':
        return this.ruleCache;
      case 'node':
        return this.nodeCache;
      case 'evidence':
        return this.evidenceCache;
      case 'pixel':
        return this.pixelCache;
    }
  }
}

// ============================================================================
// Cache Key Generators
// ============================================================================

/**
 * Generate rule-level cache key.
 *
 * @param ruleId - Rule ID
 * @param documentRevision - Document revision
 * @param scopeId - Scope ID (optional, for page/selection scope)
 * @returns Cache key
 */
export function generateRuleCacheKey(
  ruleId: string,
  documentRevision: number,
  scopeId?: string,
): string {
  if (scopeId) {
    return `${ruleId}:${documentRevision}:${scopeId}`;
  }
  return `${ruleId}:${documentRevision}`;
}

/**
 * Generate node-level cache key.
 *
 * @param ruleId - Rule ID
 * @param nodeId - Node ID
 * @param nodeRevision - Node revision
 * @returns Cache key
 */
export function generateNodeCacheKey(ruleId: string, nodeId: NodeId, nodeRevision: number): string {
  return `${ruleId}:${nodeId}:${nodeRevision}`;
}

/**
 * Generate evidence-level cache key.
 *
 * @param ruleId - Rule ID
 * @param nodeId - Node ID
 * @param evidenceHash - Evidence hash
 * @returns Cache key
 */
export function generateEvidenceCacheKey(
  ruleId: string,
  nodeId: NodeId,
  evidenceHash: string,
): string {
  return `${ruleId}:${nodeId}:${evidenceHash}`;
}

/**
 * Generate pixel-level cache key.
 *
 * @param ruleId - Rule ID
 * @param imageId - Image ID
 * @param imageHash - Image hash
 * @param parameters - Additional parameters
 * @returns Cache key
 */
export function generatePixelCacheKey(
  ruleId: string,
  imageId: string,
  imageHash: string,
  parameters: Record<string, unknown>,
): string {
  const paramsStr = JSON.stringify(parameters);
  return `${ruleId}:${imageId}:${imageHash}:${paramsStr}`;
}

// ============================================================================
// Cache Validators
// ============================================================================

/**
 * Create document revision validator.
 *
 * @param currentRevision - Current document revision
 * @returns Validator function
 */
export function createDocumentRevisionValidator(currentRevision: number): CacheValidator {
  return (result: CachedResult) => {
    return result.documentRevision === currentRevision;
  };
}

/**
 * Create node revision validator.
 *
 * @param currentRevision - Current node revision
 * @returns Validator function
 */
export function createNodeRevisionValidator(currentRevision: number): CacheValidator {
  return (result: CachedResult) => {
    return result.nodeRevision === undefined || result.nodeRevision === currentRevision;
  };
}

/**
 * Create evidence hash validator.
 *
 * @param currentHash - Current evidence hash
 * @returns Validator function
 */
export function createEvidenceHashValidator(currentHash: string): CacheValidator {
  return (result: CachedResult) => {
    return result.evidenceHash === currentHash;
  };
}

/**
 * Create timestamp validator (cache expires after maxAgeMs).
 *
 * @param maxAgeMs - Maximum age in milliseconds
 * @returns Validator function
 */
export function createTimestampValidator(maxAgeMs: number): CacheValidator {
  return (result: CachedResult) => {
    const age = Date.now() - result.timestamp;
    return age < maxAgeMs;
  };
}
