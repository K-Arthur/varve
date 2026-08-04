/**
 * usePageThumbnail — renders a page thumbnail via the unified engine pipeline.
 *
 * Uses the same engine IR path as the main canvas, so page thumbnails
 * respect effects, blend modes, opacity, strokes, and image fills.
 *
 * Capability-checked: returns null when OffscreenCanvas or HTML canvas
 * is unavailable (e.g., jsdom test environments), preventing spurious
 * console errors while keeping the production path unchanged.
 *
 * Generation uses a generation-counter guard to prevent stale state
 * updates after unmount or re-render with a different page id. The
 * hook also tracks which jobs are in-flight to avoid duplicate
 * generations when PageNav re-renders multiple times.
 */

import { hasAnyCanvas, hasImageEncoding } from '@varve/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { generateDocThumbnail } from '../../thumbnail';

/** LRU cache keyed by page id — survives mount/unmount of page tabs. */
const thumbnailCache = new Map<string, string>();
const MAX_CACHE = 50;

/** Tracks in-flight generation per page id to prevent duplicate jobs. */
const pendingJobs = new Set<string>();

export function usePageThumbnail(pageId: string): string | null {
  const { state } = useEditor();
  const [dataUrl, setDataUrl] = useState<string | null>(() => thumbnailCache.get(pageId) ?? null);
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

  const generate = useCallback(async () => {
    // Capability gate: avoid spurious errors in environments without canvas
    if (!hasAnyCanvas() || !hasImageEncoding()) return;

    // Duplicate job prevention: one in-flight per page id
    if (pendingJobs.has(pageId)) return;
    pendingJobs.add(pageId);

    const genId = ++generationRef.current;
    const doc = docRef.current;

    try {
      const result = await generateDocThumbnail(doc, {
        source: { type: 'page', pageId },
        maxWidth: 180,
        maxHeight: 90,
        fit: 'contain',
        background: { type: 'solid', color: '#ffffff' },
      });

      if (!mountedRef.current) return;

      if (result && genId === generationRef.current) {
        thumbnailCache.set(pageId, result.dataUrl);
        if (thumbnailCache.size > MAX_CACHE) {
          const firstKey = thumbnailCache.keys().next().value;
          if (firstKey) thumbnailCache.delete(firstKey);
        }
        setDataUrl(result.dataUrl);
      }
    } finally {
      pendingJobs.delete(pageId);
    }
  }, [pageId]);

  useEffect(() => {
    const page = state.document.pages?.find((p) => p.id === pageId);
    if (!page) return;

    const cached = thumbnailCache.get(pageId);
    if (cached && generationRef.current > 0) {
      return;
    }

    generate();

    return () => {
      // Bump generation counter to invalidate any stale in-flight result
      generationRef.current++;
    };
  }, [pageId, state.document, generate]);

  return dataUrl;
}

export function clearPageThumbnailCache(): void {
  thumbnailCache.clear();
  pendingJobs.clear();
}
