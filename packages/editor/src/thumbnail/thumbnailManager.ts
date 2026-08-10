/**
 * ThumbnailManager — high-level lifecycle for a file's project thumbnail.
 *
 * Uses the canonical service (scene resolution → flattenSceneToEngine →
 * engine IR replay), identity-keyed persistence, and the shared bounded
 * scheduler. Save-time generation is non-blocking and never competes with
 * canvas interaction.
 */

import type { Platform, ThumbnailSourcePreference } from '@varve/platform';
import type { Document } from '@varve/scene';
import { THUMBNAIL_VARIANTS, type ThumbnailSourceSpec } from '@varve/shared';
import { getThumbnailScheduler } from './scheduler';
import { persistDocThumbnail, renderDocThumbnail } from './thumbnailService';

/** Convert the persisted preference to the canonical source spec. */
export function preferenceToSource(preference: ThumbnailSourcePreference): ThumbnailSourceSpec {
  switch (preference.type) {
    case 'automatic':
      return { type: 'automatic' };
    case 'page':
      return { type: 'page', pageId: preference.pageId };
    case 'frame':
      return { type: 'frame', nodeId: preference.nodeId };
    case 'selection':
      return { type: 'selection', nodeIds: preference.nodeIds };
    case 'region':
      return { type: 'region', region: preference.region };
    default:
      return { type: 'automatic' } as const;
  }
}

export interface PersistProjectThumbnailOptions {
  /** Stable file identity — participates in the cache key. */
  fileId?: string;
  /** Source preference; undefined = automatic. */
  preference?: ThumbnailSourcePreference;
  /** Priority of the job (default 'current-doc'). */
  priority?: 'visible' | 'current-doc' | 'background' | 'idle';
}

/**
 * Generate and persist a project thumbnail for the given document.
 * Non-blocking by default: enqueues on the shared scheduler so a busy save
 * flow never stalls on thumbnail work. Returns true when a job was queued
 * (not when it completed).
 */
export function persistProjectThumbnail(
  platform: Platform,
  doc: Document,
  options: PersistProjectThumbnailOptions = {},
): boolean {
  const source: ThumbnailSourceSpec = options.preference
    ? preferenceToSource(options.preference)
    : { type: 'automatic' };
  const scheduler = getThumbnailScheduler();
  if (scheduler.isShutdown) return false;

  const jobKey = `file-thumb:${options.fileId ?? 'anon'}:${source.type}`;
  scheduler.enqueue({
    key: jobKey,
    priority: options.priority ?? 'current-doc',
    run: async (signal) => {
      if (signal.aborted) return;
      await persistDocThumbnail(platform, doc, {
        fileId: options.fileId,
        source,
        variant: THUMBNAIL_VARIANTS['home-card'],
        signal,
      });
    },
  });
  return true;
}

/**
 * Synchronous-render variant for preview paths (picker dialogs, tests) that
 * need the result now. Returns null on any failure.
 */
export async function renderProjectThumbnailNow(
  platform: Platform,
  doc: Document,
  options: PersistProjectThumbnailOptions & { persist?: boolean } = {},
): Promise<{ dataUrl: string; key: string } | null> {
  const source: ThumbnailSourceSpec = options.preference
    ? preferenceToSource(options.preference)
    : { type: 'automatic' };
  try {
    if (options.persist !== false) {
      const outcome = await persistDocThumbnail(platform, doc, {
        fileId: options.fileId,
        source,
        variant: THUMBNAIL_VARIANTS['home-card'],
      });
      if (!outcome?.result?.dataUrl) return null;
      return { dataUrl: outcome.result.dataUrl, key: outcome.identity.key };
    }
    const outcome = await renderDocThumbnail(doc, {
      fileId: options.fileId,
      source,
      variant: THUMBNAIL_VARIANTS['home-card'],
    });
    if (!outcome.result?.dataUrl) return null;
    return { dataUrl: outcome.result.dataUrl, key: outcome.identity.key };
  } catch {
    return null;
  }
}

/**
 * Clear cached thumbnail(s) for a file. Clears the canonical entry for the
 * current revision (identity unknown without a full render — clear by the
 * legacy key plus a prefix sweep where supported) and the legacy entry.
 */
export async function clearPersistedThumbnail(
  platform: Platform,
  hash: string,
  identityKeys: string[] = [],
): Promise<void> {
  try {
    await platform.deleteThumbnail(hash);
  } catch {
    // Best-effort
  }
  for (const key of identityKeys) {
    try {
      await platform.deleteThumbnail(key);
    } catch {
      // Best-effort
    }
  }
}
