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

import type { RenderItem } from '@strata/engine';
import { type ReplayTarget, replayIr } from '@strata/engine';

declare global {
  interface Window {
    __renderFixture: (items: RenderItem[], width: number, height: number) => void;
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

window.__harnessReady = true;
