import { createEngine, type Engine } from '@varve/engine';
import type { Document, PresentationSlideEntry } from '@varve/scene';
import { useEffect, useRef, useState } from 'react';
import { capturePresentationFrame } from './presentationCapture';

const THUMBNAIL_SCALE = 0.18;
const THUMBNAIL_CACHE_LIMIT = 12;
const thumbnailCache = new Map<string, string>();
let enginePromise: Promise<Engine> | null = null;

function getEngine(): Promise<Engine> {
  enginePromise ??= createEngine('auto');
  return enginePromise;
}

function rememberThumbnail(key: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  thumbnailCache.set(key, url);
  while (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
    const oldest = thumbnailCache.keys().next().value as string | undefined;
    if (!oldest) break;
    URL.revokeObjectURL(thumbnailCache.get(oldest)!);
    thumbnailCache.delete(oldest);
  }
  return url;
}

export function PresentationThumbnail({
  document,
  entry,
  revision,
}: {
  document: Document;
  entry: PresentationSlideEntry;
  revision: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const elementRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((candidate) => candidate.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const frame = document.nodes[entry.frameId];
    if (frame?.kind !== 'frame' || frame.frameRole === 'exportRegion') {
      setUrl(null);
      setFailed(true);
      return;
    }
    const key = `${document.id}:${revision}:${entry.id}:${THUMBNAIL_SCALE}`;
    const cached = thumbnailCache.get(key);
    if (cached) {
      thumbnailCache.delete(key);
      thumbnailCache.set(key, cached);
      setUrl(cached);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    setUrl(null);
    setFailed(false);
    void (async () => {
      try {
        const engine = await getEngine();
        const captured = await capturePresentationFrame(
          document,
          entry,
          engine,
          controller.signal,
          THUMBNAIL_SCALE,
        );
        if (controller.signal.aborted) return;
        setUrl(rememberThumbnail(key, captured.blob));
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [document, entry, revision, visible]);

  return (
    <span className="presentation-navigator__thumbnail" aria-hidden="true" ref={elementRef}>
      {url ? (
        <img src={url} alt="" />
      ) : failed ? (
        <span>Preview unavailable</span>
      ) : (
        <span>Loading preview…</span>
      )}
    </span>
  );
}
