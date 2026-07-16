/**
 * useThumbnail — renders a simplified 28×28 thumbnail for a scene node.
 *
 * Uses OffscreenCanvas with requestIdleCallback for non-blocking rendering.
 * Falls back to setTimeout if requestIdleCallback is unavailable.
 *
 * Backed by a shared LRU cache (`ThumbnailCache`) keyed on node identity +
 * kind + a fill hash: rows re-mount constantly as the layers-panel
 * virtualizer scrolls them in/out of view, and without a cache every
 * re-mount re-rendered from scratch. On a cache hit the thumbnail is
 * available synchronously (no idle-callback round trip); a miss falls back
 * to the original async render path and populates the cache for next time.
 *
 * Research basis: OffscreenCanvas (WICG), idle-until-urgent pattern.
 */

import { getImageCache } from '@strata/engine';
import type { Document, SceneNode, ShapeNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { managedColorToRgba } from '@strata/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ThumbnailCache, thumbnailCacheKey } from './thumbnailCache';

const THUMB_W = 28;
const THUMB_H = 28;
const PADDING = 2;

async function renderNodeToCanvas(
  node: SceneNode,
  canvas: OffscreenCanvas | HTMLCanvasElement,
  doc?: Pick<Document, 'rasterMaskAssets'>,
) {
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;

  ctx.clearRect(0, 0, THUMB_W, THUMB_H);

  const fill = node.fill
    ? (() => {
        const [r, g, b, a] = managedColorToRgba(node.fill!);
        return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
      })()
    : 'rgba(200,200,200,1)';

  const area = THUMB_W - PADDING * 2;
  const ox = PADDING;
  const oy = PADDING;

  ctx.fillStyle = fill;

  // Image fill thumbnail: render the actual image content.
  if (node.kind === 'shape' && isImageShape(node)) {
    const imgFill = (node as ShapeNode).fills?.find((f) => f.type === 'image' && f.image?.src);
    if (imgFill?.image) {
      try {
        const img = await getImageCache().load(imgFill.image.src);
        ctx.drawImage(img, ox, oy, area, area);
      } catch {
        ctx.fillStyle = 'rgba(200,200,200,0.5)';
        ctx.fillRect(ox, oy, area, area);
      }
      return canvas;
    }
  }

  if (node.kind === 'shape') {
    const s = (node as ShapeNode).shape;
    switch (s.kind) {
      case 'rect':
        ctx.fillRect(ox, oy, area, area);
        break;
      case 'ellipse': {
        const scaleE = area / 2 / Math.min(s.rx, s.ry);
        ctx.beginPath();
        ctx.ellipse(ox + area / 2, oy + area / 2, s.rx * scaleE, s.ry * scaleE, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'circle': {
        const scaleC = area / 2 / s.r;
        ctx.beginPath();
        ctx.arc(ox + area / 2, oy + area / 2, s.r * scaleC, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'line': {
        ctx.strokeStyle = fill;
        ctx.lineWidth = Math.max(1, s.tolerance);
        ctx.beginPath();
        ctx.moveTo(ox, oy + area / 2);
        ctx.lineTo(ox + area, oy + area / 2);
        ctx.stroke();
        break;
      }
      case 'path': {
        const pts = s.points;
        if (pts.length > 0 && pts[0]) {
          ctx.beginPath();
          ctx.moveTo(ox + (pts[0].x % area), oy + (pts[0].y % area));
          for (let i = 1; i < pts.length; i++) {
            const pt = pts[i];
            if (pt) ctx.lineTo(ox + (pt.x % area), oy + (pt.y % area));
          }
          if (s.closed) {
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.stroke();
          }
        }
        break;
      }
      default:
        ctx.fillRect(ox, oy, area, area);
    }
  } else if (node.kind === 'text') {
    ctx.fillStyle = fill;
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', ox + area / 2 - 4, oy + area / 2);
  } else if (
    'src' in node &&
    typeof (node as unknown as Record<string, unknown>).src === 'string'
  ) {
    ctx.fillStyle = 'rgba(200,200,255,0.3)';
    ctx.fillRect(ox, oy, area, area);
  } else {
    ctx.fillRect(ox, oy, area, area);
  }

  // Apply raster mask: mask image's alpha channel clips the rendered content.
  const rasterMaskRef = node.mask?.rasterMask?.assetId;
  const maskAsset = rasterMaskRef && doc ? doc.rasterMaskAssets?.[rasterMaskRef] : undefined;
  if (maskAsset?.dataUrl) {
    try {
      const maskImg = await getImageCache().load(maskAsset.dataUrl);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(maskImg, ox, oy, area, area);
      ctx.globalCompositeOperation = 'source-over';
    } catch {
      // Mask unavailable: thumbnail shows unmasked content
    }
  }

  return canvas;
}

/** Shared across every row — thumbnails survive virtualizer mount/unmount. */
export const sharedThumbnailCache = new ThumbnailCache();

export function useThumbnail(
  node: SceneNode,
  docId?: string,
  doc?: Pick<Document, 'rasterMaskAssets'>,
): string | null {
  const cacheKey = thumbnailCacheKey(node, docId);
  const docRef = useRef(doc);
  docRef.current = doc;
  const [dataUrl, setDataUrl] = useState<string | null>(
    () => sharedThumbnailCache.get(cacheKey) ?? null,
  );
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const activeKeyRef = useRef(cacheKey);
  activeKeyRef.current = cacheKey;

  const render = useCallback(async (key: string) => {
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    let useOffscreen = false;

    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(THUMB_W, THUMB_H);
      useOffscreen = true;
    } else {
      canvas = document.createElement('canvas');
      canvas.width = THUMB_W;
      canvas.height = THUMB_H;
    }

    await renderNodeToCanvas(nodeRef.current, canvas, docRef.current);

    if (useOffscreen) {
      const blob = await (canvas as OffscreenCanvas).convertToBlob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const url = reader.result as string;
        sharedThumbnailCache.set(key, url);
        if (activeKeyRef.current === key) setDataUrl(url);
      };
      reader.readAsDataURL(blob);
    } else {
      const url = (canvas as HTMLCanvasElement).toDataURL('image/png');
      sharedThumbnailCache.set(key, url);
      if (activeKeyRef.current === key) setDataUrl(url);
    }
  }, []);

  useEffect(() => {
    const cached = sharedThumbnailCache.get(cacheKey);
    if (cached) {
      setDataUrl(cached);
      return;
    }

    // Cache miss — reset and render in idle callback.
    setDataUrl(null);

    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => void render(cacheKey), { timeout: 300 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(() => void render(cacheKey), 50);
    return () => clearTimeout(id);
  }, [cacheKey, render]);

  return dataUrl;
}
