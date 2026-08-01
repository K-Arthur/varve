/**
 * Gradient-map E2E helpers: adjustment-layer creation, canvas pixel hashing,
 * and the UI-driven gradient-map add path.
 */

import type { Page } from '@playwright/test';
import { navigateToEditor } from '../shared';

export const CONTENT_CANVAS = 'canvas.editor-canvas__content-layer';

/**
 * Navigate into the editor with retries. The Vite dev server compiles this
 * app's module graph on demand and a cold graph can exceed the 45s goto
 * timeout in `shared.navigateToEditor` on the first page load; the retry hits
 * the now-warm graph. (See docs/implementation/gradient-map-progress.md §9.4.)
 */
export async function navigateToEditorWithRetry(page: Page, attempts = 3): Promise<void> {
  // Prime this browser context first. `shared.navigateToEditor` uses a fixed
  // 45s `goto`, which a cold graph blows through on a loaded dev machine —
  // retrying it alone just hits the same wall three times. One tolerant load
  // (waitUntil 'commit', long budget) gets the modules parsed and cached in
  // process, after which the real navigation is fast.
  // Budgets must fit inside the spec's own test timeout (these specs raise it
  // to 180s via `test.describe.configure`); otherwise the beforeEach hook is
  // killed mid-prime and the page closes under the retry loop.
  try {
    await page.goto('/', { waitUntil: 'commit', timeout: 60000 });
    await page
      .getByRole('button', { name: /^new$/i })
      .waitFor({ state: 'visible', timeout: 60000 });
  } catch {
    // Priming is best-effort; fall through to the normal path either way.
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await navigateToEditor(page);
      return;
    } catch (err) {
      lastError = err;
      await page.waitForTimeout(1500);
    }
  }
  throw lastError;
}

/** A distinctive blue->yellow gradient map (shadows blue, highlights yellow).
 *  Any non-neutral source content is visibly remapped, so pixel-hash
 *  assertions are robust across raster, vector, and text targets. */
export function colorfulGradientMapAdjustment() {
  return [
    {
      id: 'gm-e2e',
      kind: 'gradientMap',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      stops: [
        { position: 0, color: [30, 60, 220, 255] },
        { position: 0.5, color: [120, 140, 160, 255] },
        { position: 1, color: [255, 210, 40, 255] },
      ],
      dither: true,
      preserveLuminosity: false,
      ditherSize: 8,
    },
  ];
}

/** Create an adjustment layer via the editor context (walks the React fiber
 *  tree; same technique as tests/e2e/effects/gradient-map.spec.ts).
 *  `initialAdjustments` is forwarded to createAdjustmentLayer. */
export async function createAdjustmentLayer(
  page: Page,
  initialAdjustments?: unknown[],
): Promise<boolean> {
  return page.evaluate((initial) => {
    try {
      const container = document.getElementById('root');
      if (!container) return false;
      const fiberKey = Object.keys(container).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return false;

      function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        const mp = fiber.memoizedProps as Record<string, unknown> | undefined;
        if (
          mp?.value &&
          typeof mp.value === 'object' &&
          'createAdjustmentLayer' in (mp.value as Record<string, unknown>)
        ) {
          return mp.value as Record<string, unknown>;
        }
        const pp = fiber.pendingProps as Record<string, unknown> | undefined;
        if (
          pp?.value &&
          typeof pp.value === 'object' &&
          'createAdjustmentLayer' in (pp.value as Record<string, unknown>)
        ) {
          return pp.value as Record<string, unknown>;
        }
        return (
          walk(fiber.child as Record<string, unknown> | null) ||
          walk(fiber.sibling as Record<string, unknown> | null)
        );
      }

      const ctx = walk(
        (container as unknown as Record<string, unknown>)[fiberKey] as Record<
          string,
          unknown
        > | null,
      );
      if (ctx && typeof ctx.createAdjustmentLayer === 'function') {
        (ctx.createAdjustmentLayer as (initial: unknown[] | undefined) => void)(
          initial as unknown[] | undefined,
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, initialAdjustments);
}

/**
 * Compute a deterministic pixel signature of the content canvas. Reads the
 * real composited pixels (device pixels), sampling a fixed stride so the cost
 * stays small. Returns a number; different signatures => visually different
 * content-layer output.
 */
export async function contentCanvasHash(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!canvas) return -1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return -1;
    const stride = Math.max(1, Math.floor(Math.min(w, h) / 48));
    const data = ctx.getImageData(0, 0, w, h).data;
    let acc = 0;
    let nonTransparent = 0;
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const o = (y * w + x) * 4;
        const r = data[o]!;
        const g = data[o + 1]!;
        const b = data[o + 2]!;
        const a = data[o + 3]!;
        acc = (acc + (r << 2) + (g << 1) + b + a * 5) | 0;
        acc = (acc * 31 + r + g + b) | 0;
        if (a > 0) nonTransparent += 1;
      }
    }
    return acc + nonTransparent * 100003;
  });
}

/** Poll `contentCanvasHash` until `predicate` returns true. */
export async function waitForCanvasHash(
  page: Page,
  predicate: (hash: number) => boolean,
  label: string,
  timeout = 8000,
): Promise<number> {
  const deadline = Date.now() + timeout;
  let last = -1;
  while (Date.now() < deadline) {
    last = await contentCanvasHash(page);
    if (predicate(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for canvas hash to satisfy: ${label} (last=${last})`);
}

/**
 * Wait until the content canvas has settled (two consecutive identical
 * hashes), then return that stable hash. Guards against async raster decode /
 * camera settle producing a transient `before` snapshot that a later exact
 * undo assertion could never match.
 */
export async function waitForStableCanvasHash(
  page: Page,
  label: string,
  timeout = 8000,
): Promise<number> {
  const deadline = Date.now() + timeout;
  let prev = -1;
  let prevPrev = -1;
  while (Date.now() < deadline) {
    const current = await contentCanvasHash(page);
    if (current === prev && current === prevPrev && current !== -1) return current;
    prevPrev = prev;
    prev = current;
    await page.waitForTimeout(120);
  }
  throw new Error(`Timed out waiting for stable canvas hash: ${label} (last=${prev})`);
}

/**
 * Read the document's node kinds straight off the editor context.
 *
 * Structural counterpart to `contentCanvasHash`: the canvas hash proves the
 * *rendering* changed, this proves the *document* did. Undo/redo assertions
 * use it because canvas-hash equality is not a sound proxy for "the document
 * came back" — creating or removing a layer legitimately resizes the canvas
 * element (the inspector's content is selection-dependent) and can shift the
 * camera, so two visually-correct states can hash differently.
 */
export async function documentNodeKinds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const container = document.getElementById('root');
    const fiberKey = container
      ? Object.keys(container).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
        )
      : undefined;
    if (!container || !fiberKey) return [];
    function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
      if (!fiber) return null;
      for (const key of ['memoizedProps', 'pendingProps'] as const) {
        const value = (fiber[key] as Record<string, unknown> | undefined)?.value as
          | Record<string, unknown>
          | undefined;
        if (value && typeof value === 'object' && 'createAdjustmentLayer' in value) return value;
      }
      return (
        walk(fiber.child as Record<string, unknown> | null) ||
        walk(fiber.sibling as Record<string, unknown> | null)
      );
    }
    const ctx = walk(
      (container as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> | null,
    );
    const state = ctx?.state as Record<string, unknown> | undefined;
    const doc = state?.document as Record<string, unknown> | undefined;
    const nodes = (doc?.nodes ?? {}) as Record<string, Record<string, unknown>>;
    return Object.values(nodes).map((n) => String(n.kind));
  });
}

/** Add a Gradient Map adjustment to the currently selected adjustment node
 *  through the inspector UI (used by the malformed-file test). */
export async function addGradientMapViaUi(page: Page): Promise<void> {
  const adjustmentsTab = page.getByRole('tab', { name: /Adjustments/i });
  await adjustmentsTab.waitFor({ timeout: 5000 });
  await adjustmentsTab.click();
  await page.waitForTimeout(200);
  await page.locator('button.adj-panel__add-btn').click();
  await page.waitForTimeout(200);
  const menuItem = page.locator('.adj-panel__add-menu-item').filter({ hasText: 'Gradient Map' });
  await menuItem.click();
  await page.waitForTimeout(300);
  await expectGradientMapEditor(page);
}

/** Assert the gradient-map editor controls are visible. */
export async function expectGradientMapEditor(page: Page): Promise<void> {
  const { expect } = await import('@playwright/test');
  await expect(page.locator('input[aria-label="Dither gradient map"]')).toBeVisible({
    timeout: 5000,
  });
}
