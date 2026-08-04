/**
 * Visual regression test harness entry point.
 *
 * Loaded via visual-harness.html by Playwright specs under
 * tests/e2e/visual/. Exposes `window.__renderFixture` so a spec can push a
 * RenderItem[] fixture and get real browser canvas rasterization —
 * unlike jsdom (see tests/e2e/visual/README.md), a real browser's 2D
 * canvas context actually paints pixels, which is the whole point.
 *
 * Deliberately NOT the full app: this exercises `replayIr` (the engine's
 * primitive-level paint function) directly, not the full
 * CanvasArea/replaySubtreeToCtx orchestration (mask compositing, group
 * isolation surfaces, nested clips). See tests/e2e/visual/README.md for why.
 */

import type { RenderItem } from '@varve/engine';
import { type ReplayTarget, replayIr } from '@varve/engine';

declare global {
  interface Window {
    __renderFixture: (items: RenderItem[], width: number, height: number) => void;
    __renderBoardFixture: (items: RenderItem[], width: number, height: number) => void;
    __renderPartialFrame: (
      items: RenderItem[],
      width: number,
      height: number,
      dirtyRects: { x: number; y: number; w: number; h: number }[],
    ) => void;
    __capturePixels: () => number;
    __diffPixels: () => {
      diffPixels: number;
      maxDelta: number;
      total: number;
      hashA: number;
      hashB: number;
    };
    __harnessReady: boolean;
  }
}

window.__renderFixture = (items: RenderItem[], width: number, height: number) => {
  const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.clearRect(0, 0, width, height);
  replayIr(ctx as unknown as ReplayTarget, items);
};

/**
 * Partial redraw oracle: render a (possibly pruned) item subset under a
 * multi-rect clip, mimicking the production partial-redraw paint path
 * (per-rect clear + board fill + multi-path clip). Pixels outside the dirty
 * rects are retained — exactly how the real backing store behaves — so
 * rendering the oracle frame on top of the full frame and diffing must be
 * pixel-identical when the pruned subset is correct.
 */
/** Full redraw oracle with an explicit white board fill (matches partial). */
window.__renderBoardFixture = (items: RenderItem[], width: number, height: number) => {
  const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  replayIr(ctx as unknown as ReplayTarget, items);
};

window.__renderPartialFrame = (
  items: RenderItem[],
  width: number,
  height: number,
  dirtyRects: { x: number; y: number; w: number; h: number }[],
) => {
  const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  for (const rect of dirtyRects) {
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.save();
  ctx.beginPath();
  for (const rect of dirtyRects) {
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.clip();
  replayIr(ctx as unknown as ReplayTarget, items);
  ctx.restore();
};

interface PixelCapture {
  hash: number;
  pixels: Uint8ClampedArray;
}

let lastCapture: PixelCapture | null = null;

function capturePixels(): PixelCapture {
  const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let hash = 0x811c9dc5;
  const data = image.data;
  // Sample every pixel; FNV-1a over the raw RGBA bytes.
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 4; k++) {
      hash ^= data[i + k]!;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return { hash: hash >>> 0, pixels: data };
}

/** Capture the current canvas pixels as the oracle reference. */
window.__capturePixels = () => {
  lastCapture = capturePixels();
  return lastCapture.hash;
};

/** Diff the current canvas against the last capture; clears the reference. */
window.__diffPixels = () => {
  const current = capturePixels();
  const reference = lastCapture;
  lastCapture = null;
  if (!reference) return { diffPixels: -1, maxDelta: 0, total: 0, hashA: 0, hashB: 0 };
  let diffPixels = 0;
  let maxDelta = 0;
  const a = reference.pixels;
  const b = current.pixels;
  const total = Math.min(a.length, b.length) / 4;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const delta = Math.abs(a[i]! - b[i]!);
    if (delta > 0) {
      if (i % 4 === 0) diffPixels++;
      maxDelta = Math.max(maxDelta, delta);
    }
  }
  return {
    diffPixels,
    maxDelta,
    total,
    hashA: reference.hash,
    hashB: current.hash,
  };
};

window.__harnessReady = true;
