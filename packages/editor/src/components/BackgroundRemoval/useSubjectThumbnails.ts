import type { MaskComponent } from '@strata/engine';
import { useEffect, useRef, useState } from 'react';

export interface SubjectThumbnail {
  /** Source image crop with mask applied, checkerboard behind. */
  thumbnail: string;
  /** Grayscale mask-only view of this component. */
  maskOnly: string;
}

const THUMBNAIL_SIZE = 128;
const MAX_CACHE = 50;

/**
 * Lazily generate per-component thumbnails from the source image and mask.
 * Uses requestIdleCallback for non-blocking generation and aborts on session change.
 */
export function useSubjectThumbnails(
  sourceSrc: string,
  components: MaskComponent[],
  pendingMaskDataUrl: string,
  sourceWidth: number,
  sourceHeight: number,
): Map<number, SubjectThumbnail> {
  const [thumbnails, setThumbnails] = useState<Map<number, SubjectThumbnail>>(() => new Map());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sourceSrc || components.length === 0 || sourceWidth <= 0 || sourceHeight <= 0) {
      setThumbnails(new Map());
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    let cancelled = false;

    async function generateThumbnails() {
      // Load source image
      const img = await loadImage(sourceSrc, controller.signal);
      if (cancelled || !img) return;

      // Load mask
      const maskImg = await loadImage(pendingMaskDataUrl, controller.signal);
      if (cancelled || !maskImg) return;

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = sourceWidth;
      maskCanvas.height = sourceHeight;
      const maskCtx = maskCanvas.getContext('2d')!;
      maskCtx.drawImage(maskImg, 0, 0, sourceWidth, sourceHeight);
      const maskData = maskCtx.getImageData(0, 0, sourceWidth, sourceHeight);

      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = sourceWidth;
      sourceCanvas.height = sourceHeight;
      const sourceCtx = sourceCanvas.getContext('2d')!;
      sourceCtx.drawImage(img, 0, 0, sourceWidth, sourceHeight);
      const sourceData = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight);

      const result = new Map<number, SubjectThumbnail>();

      // Generate thumbnails via idle callbacks, limiting batch size
      const batchSize = 3;
      for (let i = 0; i < components.length; i += batchSize) {
        if (cancelled || controller.signal.aborted) return;

        const batch = components.slice(i, i + batchSize);
        await new Promise<void>((resolve) => {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(
              () => {
                for (const comp of batch) {
                  if (cancelled) break;
                  result.set(
                    comp.id,
                    generateComponentThumbnail(
                      comp,
                      sourceData,
                      maskData,
                      sourceWidth,
                      sourceHeight,
                    ),
                  );
                }
                resolve();
              },
              { timeout: 2000 },
            );
          } else {
            // Fallback for environments without requestIdleCallback
            for (const comp of batch) {
              if (cancelled) break;
              result.set(
                comp.id,
                generateComponentThumbnail(comp, sourceData, maskData, sourceWidth, sourceHeight),
              );
            }
            resolve();
          }
        });
      }

      if (!cancelled) {
        // Evict if over limit
        if (result.size > MAX_CACHE) {
          const entries = [...result.entries()];
          result.clear();
          for (const entry of entries.slice(-MAX_CACHE)) {
            result.set(entry[0], entry[1]);
          }
        }
        setThumbnails(new Map(result));
      }
    }

    generateThumbnails().catch(() => {
      // Silently handle load failures (cross-origin, etc.)
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sourceSrc, components, pendingMaskDataUrl, sourceWidth, sourceHeight]);

  return thumbnails;
}

function loadImage(src: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!signal.aborted) resolve(img);
      else resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function generateComponentThumbnail(
  component: MaskComponent,
  sourceData: ImageData,
  maskData: ImageData,
  sourceWidth: number,
  sourceHeight: number,
): SubjectThumbnail {
  const { bbox } = component;

  // Clamp bbox to image bounds
  const bx = Math.max(0, bbox.x);
  const by = Math.max(0, bbox.y);
  const bw = Math.min(bbox.w, sourceWidth - bx);
  const bh = Math.min(bbox.h, sourceHeight - by);

  if (bw <= 0 || bh <= 0) {
    return { thumbnail: '', maskOnly: '' };
  }

  // Generate thumbnail (masked source on checkerboard)
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = THUMBNAIL_SIZE;
  thumbCanvas.height = THUMBNAIL_SIZE;
  const ctx = thumbCanvas.getContext('2d')!;

  // Checkerboard background
  const checkSize = 4;
  for (let y = 0; y < THUMBNAIL_SIZE; y += checkSize) {
    for (let x = 0; x < THUMBNAIL_SIZE; x += checkSize) {
      ctx.fillStyle =
        (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0 ? '#e0e0e0' : '#ffffff';
      ctx.fillRect(x, y, checkSize, checkSize);
    }
  }

  // Draw masked source crop
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = bw;
  tempCanvas.height = bh;
  const tempCtx = tempCanvas.getContext('2d')!;
  const tempData = tempCtx.createImageData(bw, bh);

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const srcIdx = ((by + y) * sourceWidth + (bx + x)) * 4;
      const dstIdx = (y * bw + x) * 4;
      const maskIdx = (by + y) * sourceWidth + (bx + x);
      const alpha = (maskData.data[maskIdx] ?? 0) / 255;

      tempData.data[dstIdx] = sourceData.data[srcIdx] ?? 0;
      tempData.data[dstIdx + 1] = sourceData.data[srcIdx + 1] ?? 0;
      tempData.data[dstIdx + 2] = sourceData.data[srcIdx + 2] ?? 0;
      tempData.data[dstIdx + 3] = Math.round(alpha * 255);
    }
  }

  tempCtx.putImageData(tempData, 0, 0);

  // Scale to fit thumbnail
  const scale = Math.min(THUMBNAIL_SIZE / bw, THUMBNAIL_SIZE / bh);
  const dw = bw * scale;
  const dh = bh * scale;
  const dx = (THUMBNAIL_SIZE - dw) / 2;
  const dy = (THUMBNAIL_SIZE - dh) / 2;
  ctx.drawImage(tempCanvas, dx, dy, dw, dh);

  const thumbnail = thumbCanvas.toDataURL('image/png');

  // Generate mask-only view
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = THUMBNAIL_SIZE;
  maskCanvas.height = THUMBNAIL_SIZE;
  const maskCtx = maskCanvas.getContext('2d')!;

  // Black background
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);

  // Draw grayscale mask crop
  const maskTempCanvas = document.createElement('canvas');
  maskTempCanvas.width = bw;
  maskTempCanvas.height = bh;
  const maskTempCtx = maskTempCanvas.getContext('2d')!;
  const maskTempData = maskTempCtx.createImageData(bw, bh);

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const maskIdx = (by + y) * sourceWidth + (bx + x);
      const v = maskData.data[maskIdx] ?? 0;
      const dstIdx = (y * bw + x) * 4;
      maskTempData.data[dstIdx] = v;
      maskTempData.data[dstIdx + 1] = v;
      maskTempData.data[dstIdx + 2] = v;
      maskTempData.data[dstIdx + 3] = 255;
    }
  }

  maskTempCtx.putImageData(maskTempData, 0, 0);
  maskCtx.drawImage(maskTempCanvas, dx, dy, dw, dh);

  const maskOnly = maskCanvas.toDataURL('image/png');

  return { thumbnail, maskOnly };
}
