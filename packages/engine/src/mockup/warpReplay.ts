/**
 * Replay for the `warpedImage` primitive (mockup perspective surfaces).
 *
 * Extracted from replay.ts to keep the protected replay hot path within its
 * complexity ceiling: the warp is CPU ImageData work and deserves its own
 * module and tests.
 */

import { imagePlaceholderFill } from '../imagePlaceholder';
import { resolveImageResourceHandle } from '../imageResourceRegistry';
import type { ReplayTarget } from '../replay';
import type { Primitive } from '../types';
import { fitRect } from './fit';
import type { Quad, Vec2 } from './homography';
import { warpImageToQuad } from './quadWarp';

/** Cap for a single warped surface's output per axis (bounded CPU work). */
export const MAX_WARP_PX = 4096;

/** Image resolution hook (worker bitmap lookup vs main-thread image cache). */
export type WarpImageResolver = (src: string) => CanvasImageSource | undefined;

/** Structural slice of the image cache the resolver needs. */
export interface WarpImageCacheLike {
  get(src: string): { state: string; image: HTMLImageElement | null } | undefined;
  load(src: string): Promise<HTMLImageElement>;
}

/**
 * Paint a `warpedImage` primitive: inverse-homography warp of the source
 * raster onto the destination quad, rendered at the current transform's
 * scale so export stays crisp. Output is bounded by `MAX_WARP_PX` per axis
 * to keep low-memory devices safe; missing sources draw a deterministic
 * placeholder (the caller's cache schedules another frame on load).
 */

/**
 * Resolve an image source for replay: worker path uses the pre-decoded
 * bitmap lookup; main thread uses the shared image cache (kicking off an
 * async load when idle — the caller schedules another frame on cache
 * changes). `src` may be a canonical resource handle (registered by the
 * editor at scene conversion time); legacy raw sources (data:/blob:/http)
 * resolve directly.
 */
export function resolveReplayImage(
  src: string,
  lookup: ((src: string) => CanvasImageSource | undefined) | null,
  cache: WarpImageCacheLike,
): CanvasImageSource | undefined {
  if (lookup) {
    return lookup(src);
  }
  const loadableSource = resolveImageResourceHandle(src);
  const imgEntry = cache.get(loadableSource);
  if (imgEntry?.state === 'loaded' && imgEntry.image) {
    return imgEntry.image;
  }
  if (!imgEntry || imgEntry.state === 'idle') {
    cache.load(loadableSource).catch(() => {
      /* errors recorded in cache entry */
    });
  }
  return undefined;
}

export function paintWarpedImage(
  target: ReplayTarget,
  p: Extract<Primitive, { kind: 'warpedImage' }>,
  resolveImage: WarpImageResolver,
): void {
  const image = resolveImage(p.src);
  if (!image) {
    // Placeholder for a not-yet-loaded or failed surface (cache schedules a
    // reframe on load; a failed source keeps a distinct placeholder so
    // loading and permanent failure never look the same).
    if (target.fillStyle && target.fillRect) {
      const b = quadBoundsOf(p);
      const prev = target.fillStyle;
      target.fillStyle = imagePlaceholderFill(p.src);
      target.fillRect(b.x, b.y, b.w, b.h);
      target.fillStyle = prev;
    }
    return;
  }

  const sized = image as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const imgW = sized.naturalWidth ?? sized.width ?? p.sourceW;
  const imgH = sized.naturalHeight ?? sized.height ?? p.sourceH;
  if (!imgW || !imgH || p.sourceW <= 0 || p.sourceH <= 0) return;

  // Render scale: how many target px per primitive unit (camera + world),
  // so preview and export render the warp at matching resolution.
  let scale = 1;
  if (target.getTransform) {
    const t = target.getTransform();
    if (t) {
      const s = Math.hypot(t.a, t.b);
      if (Number.isFinite(s) && s > 0) scale = s;
    }
  }

  const bounds = quadBoundsOf(p);
  const outW = Math.max(1, Math.min(MAX_WARP_PX, Math.round(bounds.w * scale)));
  const outH = Math.max(1, Math.min(MAX_WARP_PX, Math.round(bounds.h * scale)));

  // Fit the source into the quad: the fitted rect (in unit-quad space)
  // becomes a sub-quad via bilinear interpolation of the quad corners.
  const fit = fitRect(imgW, imgH, 1, 1, p.fit === 'native' ? 'contain' : p.fit, p.alignX, p.alignY);
  if (!fit || fit.dw <= 0 || fit.dh <= 0) return;

  const quad: Quad = [
    { x: p.quad[0][0], y: p.quad[0][1] },
    { x: p.quad[1][0], y: p.quad[1][1] },
    { x: p.quad[2][0], y: p.quad[2][1] },
    { x: p.quad[3][0], y: p.quad[3][1] },
  ];
  const bilinear = (u: number, v: number): Vec2 => {
    const topX = quad[0].x + (quad[1].x - quad[0].x) * u;
    const topY = quad[0].y + (quad[1].y - quad[0].y) * u;
    const botX = quad[3].x + (quad[2].x - quad[3].x) * u;
    const botY = quad[3].y + (quad[2].y - quad[3].y) * u;
    return {
      x: topX + (botX - topX) * v,
      y: topY + (botY - topY) * v,
    };
  };
  const subQuad: Quad = [
    bilinear(fit.dx, fit.dy),
    bilinear(fit.dx + fit.dw, fit.dy),
    bilinear(fit.dx + fit.dw, fit.dy + fit.dh),
    bilinear(fit.dx, fit.dy + fit.dh),
  ];

  // Cover crops the source to the sampling rect; other fits sample the full
  // source. The warp always maps the sampled region onto the sub-quad.
  const sample = p.fit === 'cover' ? { sx: fit.sx, sy: fit.sy, sw: fit.sw, sh: fit.sh } : null;
  const sampleW = sample ? Math.max(1, Math.round(sample.sw)) : imgW;
  const sampleH = sample ? Math.max(1, Math.round(sample.sh)) : imgH;
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sampleW;
  sourceCanvas.height = sampleH;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) return;
  if (sample) {
    sourceCtx.drawImage(image, sample.sx, sample.sy, sample.sw, sample.sh, 0, 0, sampleW, sampleH);
  } else {
    sourceCtx.drawImage(image, 0, 0, imgW, imgH);
  }
  let srcData: ImageData;
  try {
    srcData = sourceCtx.getImageData(0, 0, sampleW, sampleH);
  } catch {
    return;
  }

  const warped = warpImageToQuad(srcData.data, sampleW, sampleH, subQuad, outW, outH);
  if (!warped) return;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return;
  outCtx.putImageData(warped, 0, 0);
  target.drawImage?.(
    outCanvas as unknown as CanvasImageSource,
    bounds.x,
    bounds.y,
    bounds.w,
    bounds.h,
  );
}

/** Finite bounding box of the warpedImage quad. */
export function quadBoundsOf(p: Extract<Primitive, { kind: 'warpedImage' }>): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const q = p.quad;
  let minX = Math.min(q[0][0], q[1][0], q[2][0], q[3][0]);
  let minY = Math.min(q[0][1], q[1][1], q[2][1], q[3][1]);
  let maxX = Math.max(q[0][0], q[1][0], q[2][0], q[3][0]);
  let maxY = Math.max(q[0][1], q[1][1], q[2][1], q[3][1]);
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;
  if (!Number.isFinite(maxX)) maxX = 0;
  if (!Number.isFinite(maxY)) maxY = 0;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
