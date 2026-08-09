import type { FileEntry, Platform } from '@varve/platform';
import { useCallback, useEffect, useRef, useState } from 'react';

const BATCH_SIZE = 5;
const MAX_CACHE_SIZE = 100;

interface QueueItem {
  entry: FileEntry;
  priority: number;
}

export interface ThumbnailLoader {
  thumbnails: Map<string, string | null>;
  load: (entry: FileEntry) => void;
  loadBatch: (entries: FileEntry[]) => void;
  prioritize: (entryId: string) => void;
}

export function useThumbnailLoader(platform: Platform): ThumbnailLoader {
  const [thumbnails, setThumbnails] = useState<Map<string, string | null>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);

  const evictIfNeeded = useCallback(() => {
    setThumbnails((prev) => {
      if (prev.size <= MAX_CACHE_SIZE) return prev;
      const entries = [...prev.entries()];
      const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
      const next = new Map(prev);
      for (const [key] of toRemove) {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const processSingle = useCallback(
    async (entry: FileEntry) => {
      if (thumbnails.has(entry.id) || loadingRef.current.has(entry.id)) return;
      loadingRef.current.add(entry.id);

      try {
        const dataUrl = await platform.getThumbnail(entry.contentHash);
        if (dataUrl) {
          setThumbnails((prev) => {
            const next = new Map(prev);
            next.set(entry.id, dataUrl);
            return next;
          });
          evictIfNeeded();
          return;
        }

        const json = await platform.readFile(entry.id);
        if (!json) {
          setThumbnails((prev) => {
            const next = new Map(prev);
            next.set(entry.id, null);
            return next;
          });
          return;
        }

        const { legacyRenderThumbnail } = await import('@varve/engine');
        const thumbDataUrl = await legacyRenderThumbnail(JSON.parse(json));
        if (thumbDataUrl) {
          await platform.putThumbnail({
            hash: entry.contentHash,
            dataUrl: thumbDataUrl,
            width: 256,
            height: 192,
            createdAt: Date.now(),
          });
          setThumbnails((prev) => {
            const next = new Map(prev);
            next.set(entry.id, thumbDataUrl);
            return next;
          });
          evictIfNeeded();
        }
      } catch {
        setThumbnails((prev) => {
          const next = new Map(prev);
          next.set(entry.id, null);
          return next;
        });
      } finally {
        loadingRef.current.delete(entry.id);
      }
    },
    [platform, thumbnails, evictIfNeeded],
  );

  const processQueue = useCallback(() => {
    if (processingRef.current) return;
    processingRef.current = true;

    const scheduleNext = () => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(
          () => {
            processBatch();
          },
          { timeout: 1000 },
        );
      } else {
        setTimeout(processBatch, 50);
      }
    };

    const processBatch = () => {
      const queue = queueRef.current;
      if (queue.length === 0) {
        processingRef.current = false;
        return;
      }

      queue.sort((a, b) => b.priority - a.priority);
      const batch = queue.splice(0, BATCH_SIZE);

      let completed = 0;
      for (const item of batch) {
        processSingle(item.entry).finally(() => {
          completed++;
          if (completed === batch.length) {
            scheduleNext();
          }
        });
      }
    };

    processBatch();
  }, [processSingle]);

  const load = useCallback(
    (entry: FileEntry) => {
      if (thumbnails.has(entry.id) || loadingRef.current.has(entry.id)) return;
      queueRef.current.push({ entry, priority: 0 });
      processQueue();
    },
    [thumbnails, processQueue],
  );

  const loadBatch = useCallback(
    (entries: FileEntry[]) => {
      const added: QueueItem[] = [];
      for (const entry of entries) {
        if (thumbnails.has(entry.id) || loadingRef.current.has(entry.id)) continue;
        added.push({ entry, priority: 0 });
      }
      if (added.length === 0) return;
      queueRef.current.push(...added);
      processQueue();
    },
    [thumbnails, processQueue],
  );

  const prioritize = useCallback((entryId: string) => {
    for (const item of queueRef.current) {
      if (item.entry.id === entryId) {
        item.priority = 1;
        return;
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      queueRef.current = [];
      processingRef.current = false;
    };
  }, []);

  return { thumbnails, load, loadBatch, prioritize };
}
