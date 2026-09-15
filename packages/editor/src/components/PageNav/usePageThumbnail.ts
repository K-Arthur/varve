/**
 * usePageThumbnail — renders a page thumbnail via the canonical thumbnail
 * pipeline (scene resolution → flattenSceneToEngine → engine IR replay).
 *
 * The module-level cache is keyed by the CANONICAL identity
 * (docKey + revision + page source + page-nav variant), so:
 *  - two documents with colliding page ids never share pixels;
 *  - editing the page invalidates the cache by revision;
 *  - the same page rendered for different surfaces (nav vs panel) has
 *    separate entries.
 *
 * Generation is routed through the shared bounded scheduler; in-flight
 * results are guarded by a generation token per page id.
 */

import { hasAnyCanvas, hasImageEncoding } from '@varve/engine';
import type { ThumbnailIdentity } from '@varve/shared';
import { THUMBNAIL_VARIANTS } from '@varve/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { pageThumbnailIdentity } from '../../thumbnail/identity';
import { getThumbnailScheduler } from '../../thumbnail/scheduler';
import { renderDocThumbnail } from '../../thumbnail/thumbnailService';

/** LRU cache keyed by canonical identity — survives mount/unmount. */
const thumbnailCache = new Map<string, string>();
const MAX_CACHE = 60;

/** Tracks in-flight generation per page id to prevent duplicate jobs. */
const pendingJobs = new Set<string>();

function evictIfNeeded(): void {
  while (thumbnailCache.size > MAX_CACHE) {
    const firstKey = thumbnailCache.keys().next().value;
    if (firstKey === undefined) break;
    thumbnailCache.delete(firstKey);
  }
}

export function usePageThumbnail(pageId: string, fileId?: string): string | null {
  const { state } = useEditor();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const generationRef = useRef(0);
  const docRef = useRef(state.document);
  docRef.current = state.document;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const identity = pageThumbnailIdentity(
    state.document,
    pageId,
    THUMBNAIL_VARIANTS['page-nav'],
    fileId,
  );
  const identityKey = identity.key;

  // Synchronous cache-hit path (no idle round-trip for re-mounted rows).
  useEffect(() => {
    const cached = thumbnailCache.get(identityKey);
    if (cached) {
      setDataUrl(cached);
      return;
    }
    setDataUrl(null);
  }, [identityKey]);

  const generate = useCallback(
    async (id: ThumbnailIdentity) => {
      // Capability gate: avoid spurious errors in environments without canvas.
      if (!hasAnyCanvas() || !hasImageEncoding()) return;

      // Duplicate job prevention: one in-flight per page id.
      if (pendingJobs.has(pageId)) return;
      pendingJobs.add(pageId);
      const genId = ++generationRef.current;

      try {
        const doc = docRef.current;
        getThumbnailScheduler().enqueue({
          key: `page-thumb:${id.key}`,
          priority: 'visible',
          run: async (signal) => {
            if (signal.aborted) return;
            const outcome = await renderDocThumbnail(doc, {
              fileId,
              source: { type: 'page', pageId },
              variant: THUMBNAIL_VARIANTS['page-nav'],
              signal,
            });
            if (signal.aborted || !mountedRef.current) return;
            if (genId !== generationRef.current) return;
            if (!outcome.result?.dataUrl) return;
            thumbnailCache.set(id.key, outcome.result.dataUrl);
            evictIfNeeded();
            setDataUrl(outcome.result.dataUrl);
          },
        });
      } finally {
        // The scheduler runs async; releasing the guard immediately allows
        // a later revision to queue. Correctness is enforced by the
        // generation token, not by this set.
        pendingJobs.delete(pageId);
      }
    },
    [pageId, fileId],
  );

  useEffect(() => {
    const page = state.document.pages?.find((p) => p.id === pageId);
    if (!page) return;
    if (thumbnailCache.has(identityKey)) return;
    void generate(identity);
    return () => {
      // Bump the generation counter to invalidate any stale in-flight result.
      generationRef.current++;
    };
  }, [pageId, state.document, identityKey, generate, identity]);

  return dataUrl;
}

export function clearPageThumbnailCache(): void {
  thumbnailCache.clear();
  pendingJobs.clear();
}
