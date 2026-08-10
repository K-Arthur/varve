/**
 * Thumbnail store — persistence + lookup via the platform thumbnail cache,
 * keyed by canonical identity.
 *
 * Warm migration: `loadThumbnailWithFallback` first tries the canonical
 * identity key, then the legacy bare content-hash key written by the
 * pre-canonical system. Old entries are treated as disposable optimization
 * state — they are never migrated, only read; the next save regenerates a
 * canonical entry.
 */

import type { Platform } from '@varve/platform';
import type { ThumbnailIdentity } from '@varve/shared';

/** Look up a canonical thumbnail by identity. */
export async function loadThumbnail(
  platform: Platform,
  identity: ThumbnailIdentity,
): Promise<string | undefined> {
  try {
    return await platform.getThumbnail(identity.key);
  } catch {
    return undefined;
  }
}

/**
 * Look up a thumbnail, falling back to the legacy bare content-hash key so
 * pre-canonical files keep their previews until the next save.
 */
export async function loadThumbnailWithFallback(
  platform: Platform,
  identity: ThumbnailIdentity,
  legacyKey: string,
): Promise<string | undefined> {
  const canonical = await loadThumbnail(platform, identity);
  if (canonical) return canonical;
  if (legacyKey === identity.key) return undefined;
  try {
    return await platform.getThumbnail(legacyKey);
  } catch {
    return undefined;
  }
}

/** Best-effort platform eviction (LRU by createdAt). */
export async function evictThumbnails(platform: Platform, keepCount: number): Promise<number> {
  try {
    return await platform.evictThumbnails(keepCount);
  } catch {
    return 0;
  }
}
