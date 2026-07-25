/**
 * ThumbnailManager — high-level thumbnail lifecycle for documents.
 *
 * Handles generation, source selection, refresh, and reset for a
 * document's project thumbnail (used on the home screen).
 */

import type { Platform, ThumbnailSourcePreference } from '@strata/platform';
import { contentHash } from '@strata/platform';
import type { Document } from '@strata/scene';
import type { ThumbnailSourceType } from './thumbnailSource';
import { generateDocThumbnail } from './thumbnailSource';

export interface ThumbnailManagerOptions {
  platform: Platform;
  /**
   * How long (ms) after the last edit to wait before generating
   * a new thumbnail. Default 2000.
   */
  debounceMs?: number;
}

/**
 * Generate and persist a project thumbnail for the given document.
 * Uses the source preference if provided, otherwise falls back to
 * automatic document overview.
 */
export async function persistProjectThumbnail(
  platform: Platform,
  doc: Document,
  preference?: ThumbnailSourcePreference,
): Promise<boolean> {
  try {
    const source = preferenceToSource(preference, doc);
    const result = await generateDocThumbnail(doc, {
      source,
      maxWidth: 256,
      maxHeight: 192,
      fit: 'contain',
      background: { type: 'transparent' },
    });

    if (!result) return false;

    const hash = contentHash(JSON.stringify(doc));
    await platform.putThumbnail({
      hash,
      dataUrl: result.dataUrl,
      width: result.metadata.outputWidth,
      height: result.metadata.outputHeight,
      createdAt: Date.now(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert user preference to a thumbnail source type usable by the
 * generation service. Falls back to automatic document overview when
 * the preference is undefined or targets a missing page/node.
 */
function preferenceToSource(
  preference: ThumbnailSourcePreference | undefined,
  doc: Document,
): ThumbnailSourceType {
  if (!preference || preference.type === 'automatic') {
    return { type: 'document' };
  }

  switch (preference.type) {
    case 'page': {
      const page = doc.pages?.find((p) => p.id === preference.pageId);
      if (page) return { type: 'page', pageId: preference.pageId };
      return { type: 'document' };
    }
    case 'frame': {
      if (doc.nodes[preference.nodeId]) return { type: 'frame', nodeId: preference.nodeId };
      return { type: 'document' };
    }
    case 'selection': {
      const valid = preference.nodeIds.filter((id) => doc.nodes[id]);
      if (valid.length > 0) return { type: 'selection', nodeIds: valid };
      return { type: 'document' };
    }
    default:
      return { type: 'document' };
  }
}

/**
 * Clear cached thumbnail for a content hash from the platform store
 * and regenerate it on next access.
 */
export async function clearPersistedThumbnail(platform: Platform, hash: string): Promise<void> {
  try {
    await platform.deleteThumbnail(hash);
  } catch {
    // Best-effort
  }
}
