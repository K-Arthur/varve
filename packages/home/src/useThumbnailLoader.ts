import type { FileEntry, Platform } from '@strata/platform';
import { useCallback, useRef, useState } from 'react';

export interface ThumbnailLoader {
  thumbnails: Map<string, string | null>;
  load: (entry: FileEntry) => void;
}

export function useThumbnailLoader(platform: Platform): ThumbnailLoader {
  const [thumbnails, setThumbnails] = useState<Map<string, string | null>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());

  const load = useCallback(
    (entry: FileEntry) => {
      if (thumbnails.has(entry.id) || loadingRef.current.has(entry.id)) return;
      loadingRef.current.add(entry.id);

      platform.getThumbnail(entry.contentHash).then((dataUrl) => {
        if (dataUrl) {
          setThumbnails((prev) => {
            const next = new Map(prev);
            next.set(entry.id, dataUrl);
            return next;
          });
        } else {
          platform.readFile(entry.id).then((json) => {
            if (!json) {
              setThumbnails((prev) => {
                const next = new Map(prev);
                next.set(entry.id, null);
                return next;
              });
              return;
            }
            import('@strata/engine').then(({ renderThumbnail }) => {
              try {
                const doc = JSON.parse(json);
                renderThumbnail(doc).then((thumbDataUrl) => {
                  if (thumbDataUrl) {
                    platform.putThumbnail({
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
                  }
                });
              } catch {
                setThumbnails((prev) => {
                  const next = new Map(prev);
                  next.set(entry.id, null);
                  return next;
                });
              }
            });
          });
        }
      });
    },
    [platform, thumbnails.has],
  );

  return { thumbnails, load };
}
