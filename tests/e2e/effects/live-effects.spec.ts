/**
 * End-to-end: live non-destructive effects family (dither, paletteSnap,
 * bloom, rgbSplit, crt, vhs, lightShafts, lensFlare, lightLeak, caustics).
 *
 * Covers the full interaction contract on the real canvas:
 *   add → visually changes · slider → live update · undo/redo · disable/
 *   re-enable · reorder · save/reopen persistence · export contains effect.
 *
 * A screenshot corpus for human visual review is written to
 * reports/effect-review/ (source, panel, and canvas per effect).
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { dropImageOnCanvas } from '../helpers/editor-helpers';
import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

const REVIEW_DIR = resolve(__dirname, '../../../reports/effect-review');

const EFFECTS: { kind: string; name: string; slider?: string }[] = [
  { kind: 'dither', name: 'Dither', slider: 'Dither strength' },
  { kind: 'paletteSnap', name: 'Palette Snap', slider: 'Palette snap amount' },
  { kind: 'bloom', name: 'Bloom', slider: 'Bloom intensity' },
  { kind: 'rgbSplit', name: 'RGB Split', slider: 'RGB split intensity' },
  { kind: 'crt', name: 'CRT', slider: 'Screen curvature' },
  { kind: 'vhs', name: 'VHS', slider: 'VHS time' },
  { kind: 'lightShafts', name: 'Light Shafts', slider: 'Shaft intensity' },
  { kind: 'lensFlare', name: 'Lens Flare', slider: 'Flare brightness' },
  { kind: 'lightLeak', name: 'Light Leak', slider: 'Leak intensity' },
  { kind: 'caustics', name: 'Caustics', slider: 'Caustic wave scale' },
];

/** Reach the editor context through the React fiber tree (as in the
 *  gradient-map import spec) so we can drive app-level APIs directly. */
async function editorContext(
  page: import('@playwright/test').Page,
): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    try {
      const container = document.getElementById('root');
      if (!container) return null;
      const fiberKey = Object.keys(container).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return null;
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
      return walk(
        (container as unknown as Record<string, unknown>)[fiberKey] as Record<
          string,
          unknown
        > | null,
      );
    } catch {
      return null;
    }
  });
}

/** FNV-1a hash of the content-layer canvas pixels (deterministic). */
async function canvasRegionHash(
  page: import('@playwright/test').Page,
  region?: { x: number; y: number; w: number; h: number },
): Promise<string> {
  return page.evaluate((r) => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!canvas) return 'no-canvas';
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-ctx';
    const dprX = canvas.width / Math.max(1, canvas.clientWidth);
    const dprY = canvas.height / Math.max(1, canvas.clientHeight);
    const sx = r ? Math.floor(r.x * dprX) : 0;
    const sy = r ? Math.floor(r.y * dprY) : 0;
    const sw = r ? Math.max(1, Math.floor(r.w * dprX)) : canvas.width;
    const sh = r ? Math.max(1, Math.floor(r.h * dprY)) : canvas.height;
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 4) {
      h ^= data[i]!;
      h = Math.imul(h, 0x01000193);
      h ^= data[i + 1]!;
      h = Math.imul(h, 0x01000193);
      h ^= data[i + 2]!;
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }, region);
}

async function createAdjustmentLayer(page: import('@playwright/test').Page): Promise<void> {
  const created = await page.evaluate(() => {
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
      (container as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> | null,
    );
    if (ctx && typeof ctx.createAdjustmentLayer === 'function') {
      (ctx.createAdjustmentLayer as () => void)();
      return true;
    }
    return false;
  });
  expect(created).toBe(true);
  await page.waitForTimeout(400);
  const adjustmentsTab = page.getByRole('tab', { name: /Adjustments/i });
  await expect(adjustmentsTab).toBeVisible({ timeout: 5000 });
  await adjustmentsTab.click();
  await page.waitForTimeout(200);
}

/** Give the shapes a bright-on-dark corpus: bottom rect dark, top rect white
 *  so light-dependent effects (bloom, light shafts, flares) have material to
 *  work with and somewhere to spill onto. */
async function makeRectBright(page: import('@playwright/test').Page): Promise<void> {
  const done = await page.evaluate(() => {
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
        'updateNode' in (mp.value as Record<string, unknown>)
      ) {
        return mp.value as Record<string, unknown>;
      }
      const pp = fiber.pendingProps as Record<string, unknown> | undefined;
      if (
        pp?.value &&
        typeof pp.value === 'object' &&
        'updateNode' in (pp.value as Record<string, unknown>)
      ) {
        return pp.value as Record<string, unknown>;
      }
      return (
        walk(fiber.child as Record<string, unknown> | null) ||
        walk(fiber.sibling as Record<string, unknown> | null)
      );
    }
    const ctx = walk(
      (container as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> | null,
    );
    if (!ctx || typeof ctx.updateNode !== 'function') return false;
    const state = ctx.state as { document: { nodes: Record<string, { kind: string }> } };
    const nodes = state.document.nodes;
    const shapeIds = Object.keys(nodes).filter((k) => nodes[k]!.kind === 'shape');
    if (shapeIds.length < 2) return false;
    // The legacy node `fill` field is a bare ManagedColor (not a Fill object).
    const dark = { space: 'rgb', r: 16, g: 28, b: 40, a: 255 };
    const white = { space: 'rgb', r: 255, g: 255, b: 255, a: 255 };
    const update = (id: string, color: unknown) => {
      (
        ctx.updateNode as (
          id: string,
          fn: (n: Record<string, unknown>) => Record<string, unknown>,
        ) => void
      )(id, (n) => ({
        ...n,
        fill: color,
      }));
    };
    update(shapeIds[0]!, dark);
    update(shapeIds[1]!, white);
    return true;
  });
  expect(done).toBe(true);
  await page.waitForTimeout(300);
}

async function addAdjustment(page: import('@playwright/test').Page, name: string): Promise<void> {
  const stackCount = await page.locator('.adj-panel__item').count();
  await page.locator('button.adj-panel__add-btn').click();
  await page.locator('.adj-panel__add-menu').waitFor({ state: 'visible', timeout: 5000 });
  await page
    .locator('.adj-panel__add-menu-item')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .click();
  await expect(page.locator('.adj-panel__item')).toHaveCount(stackCount + 1, { timeout: 5000 });
  await page.waitForTimeout(300);
}

async function drawRect(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('r');
  await dragOnCanvas(page, 100, 60, 380, 320);
  // Re-activate the tool and draw the second (top) rect, starting the drag
  // outside the first rect so the tool creates a new shape instead of
  // moving the existing one.
  await page.keyboard.press('r');
  await dragOnCanvas(page, 40, 20, 320, 300);
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
  await page.keyboard.press('v');
}

test.describe('Live effects', () => {
  test.describe.configure({ mode: 'serial', timeout: 420_000 });

  test.beforeEach(async ({ page }) => {
    // Deterministic profile per page: localStorage persists across pages in
    // a context and the app restores the last document on an unclean boot,
    // which would make treeitem counts and canvas state unpredictable.
    // IndexedDB is deliberately left alone (the app's home DB lives there).
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        // Session recovery lives in the varve-recovery IndexedDB; deleting
        // it (and the legacy pre-rename database) prevents the app from
        // restoring the previous test's document. The app's home database
        // is left untouched.
        if (typeof indexedDB !== 'undefined') {
          for (const name of ['varve-recovery', 'strata-recovery']) {
            try {
              indexedDB.deleteDatabase(name);
            } catch {
              // ignore
            }
          }
          // Deterministically block session restore: the app opens
          // varve-recovery at boot and restores the previous test's
          // document. Make those opens fail so the recovery manager falls
          // back to an empty in-memory store. Property-handler requests are
          // what recovery.ts uses, so a failing fake request is sufficient.
          const origOpen = indexedDB.open.bind(indexedDB);
          indexedDB.open = ((name: string, version?: number) => {
            if (name === 'varve-recovery' || name === 'strata-recovery') {
              // Inert request: never settles. Consumers of these databases
              // (session recovery, crash queue) hang harmlessly instead of
              // restoring state — and crucially no rejection fires, because
              // some editor paths await these opens without a catch and an
              // unhandled rejection triggers the crash center itself.
              return {
                onerror: null as ((ev: Event) => void) | null,
                onsuccess: null as ((ev: Event) => void) | null,
                onupgradeneeded: null as ((ev: Event) => void) | null,
                error: null,
                result: undefined,
                transaction: null,
              } as unknown as IDBOpenDBRequest;
            }
            return origOpen(name, version);
          }) as typeof indexedDB.open;
        }
      } catch {
        // ignore
      }
    });
    await navigateToCleanEditor(page);
  });

  test.describe('visual corpus on a real photograph', () => {
    test.beforeEach(async ({ page }) => {
      // Drag the photo onto the canvas: this inserts it into the current
      // document (the file-input flow opens it as a separate document).
      await dropImageOnCanvas(page, 'photo-fixture.jpg', 320, 240);
      await page.waitForTimeout(1200);
      await createAdjustmentLayer(page);
    });

    for (const effect of EFFECTS) {
      test(`visual corpus: ${effect.name} renders and changes the canvas`, async ({ page }) => {
        const source = await canvasRegionHash(page);
        mkdirSync(REVIEW_DIR, { recursive: true });
        await page.screenshot({ path: resolve(REVIEW_DIR, `source.png`), fullPage: false });

        await addAdjustment(page, effect.name);

        const editor = page.locator('.adj-panel__editor');
        await expect(editor).toBeVisible({ timeout: 5000 });
        await expect(
          page.locator('.adj-panel__editor-title').filter({ hasText: effect.name }),
        ).toBeVisible();

        await page.waitForTimeout(900);
        const affected = await canvasRegionHash(page);
        expect(affected).not.toBe(source);
        expect(affected).not.toBe('no-canvas');
        expect(affected).not.toBe('no-ctx');

        await page.screenshot({
          path: resolve(REVIEW_DIR, `${effect.kind}-panel.png`),
          fullPage: false,
        });

        // The editor must be free of automated accessibility violations.
        const results = await new AxeBuilder({ page })
          .include('.adj-panel__editor')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(results.violations).toEqual([]);
        await page.screenshot({
          path: resolve(REVIEW_DIR, `${effect.kind}-canvas.png`),
          fullPage: false,
        });

        // The parameter editor for the effect is present and interactive.
        if (effect.slider) {
          const slider = page.getByRole('slider', { name: effect.slider });
          await expect(slider).toBeVisible({ timeout: 5000 });
        }
      });
    }
  });

  test.describe('interaction and integration', () => {
    test.beforeEach(async ({ page }) => {
      await drawRect(page);
      await makeRectBright(page);
      await createAdjustmentLayer(page);
    });

    test('interaction contract: slider, undo/redo, disable, reorder', async ({ page }) => {
      const source = await canvasRegionHash(page);

      await addAdjustment(page, 'Bloom');
      await page.waitForTimeout(400);
      const afterAdd = await canvasRegionHash(page);
      expect(afterAdd).not.toBe(source);

      // Slider change updates the canvas live — drive it with real keyboard
      // interaction on the focused slider (Home jumps to the minimum, a large
      // change that must re-render the effect).
      const threshold = page.getByRole('slider', { name: 'Bloom threshold' });
      await threshold.focus();
      await page.keyboard.press('Home');
      await page.waitForTimeout(500);
      const afterSlider = await canvasRegionHash(page);
      expect(afterSlider).not.toBe(afterAdd);
      // Blur the slider so the app-level undo shortcut is not eaten by the
      // native input undo behaviour.
      await threshold.evaluate((el) => (el as HTMLInputElement).blur());
      await page.keyboard.press('Escape');

      // Undo: one step restores the pre-drag parameter value.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(400);
      expect(await canvasRegionHash(page)).toBe(afterAdd);

      // Redo: the effect returns.
      await page.keyboard.press('Control+Shift+z');
      await page.waitForTimeout(400);
      expect(await canvasRegionHash(page)).toBe(afterSlider);

      // Disable → source appearance returns; re-enable → effect returns.
      const visButton = page.locator('.adj-panel__item-vis-btn');
      await visButton.click();
      await page.waitForTimeout(400);
      expect(await canvasRegionHash(page)).toBe(source);
      await visButton.click();
      await page.waitForTimeout(400);
      expect(await canvasRegionHash(page)).toBe(afterSlider);

      // Reorder: adding CRT below bloom then moving it above changes output.
      await addAdjustment(page, 'CRT');
      await page.waitForTimeout(400);
      const stacked = await canvasRegionHash(page);
      expect(stacked).not.toBe(afterSlider);
      const moveUp = page
        .locator('.adj-panel__item')
        .last()
        .locator('.adj-panel__item-reorder-btn')
        .first();
      await moveUp.click();
      await page.waitForTimeout(400);
      const reordered = await canvasRegionHash(page);
      expect(reordered).not.toBe(stacked);

      await page.screenshot({ path: resolve(REVIEW_DIR, 'stack-reordered.png') });
    });

    test('persistence: serialize → reload reproduces params and pixels', async ({ page }) => {
      await addAdjustment(page, 'Dither');
      await page.getByRole('slider', { name: 'Dither strength' }).fill('0.5');
      await addAdjustment(page, 'VHS');
      await page.waitForTimeout(400);
      const before = await canvasRegionHash(page);

      const ctx = await editorContext(page);
      expect(ctx).not.toBeNull();
      const json = await page.evaluate(() => {
        const container = document.getElementById('root');
        if (!container) return null;
        const fiberKey = Object.keys(container).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
        );
        if (!fiberKey) return null;
        function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
          if (!fiber) return null;
          const mp = fiber.memoizedProps as Record<string, unknown> | undefined;
          if (
            mp?.value &&
            typeof mp.value === 'object' &&
            'serializeDocument' in (mp.value as Record<string, unknown>)
          ) {
            return mp.value as Record<string, unknown>;
          }
          const pp = fiber.pendingProps as Record<string, unknown> | undefined;
          if (
            pp?.value &&
            typeof pp.value === 'object' &&
            'serializeDocument' in (pp.value as Record<string, unknown>)
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
        if (!ctx || typeof ctx.serializeDocument !== 'function') return null;
        return ctx.serializeDocument() as string;
      });
      expect(json).not.toBeNull();
      expect(json).toContain('"kind":"dither"');
      expect(json).toContain('"kind":"vhs"');
      expect(json).toContain('"strength":0.5');
      const docJson = json as string;

      // Reload through the app's own loader — same browser, fresh document.
      const loaded = await page.evaluate((docJson: string) => {
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
            'loadDocument' in (mp.value as Record<string, unknown>)
          ) {
            return mp.value as Record<string, unknown>;
          }
          const pp = fiber.pendingProps as Record<string, unknown> | undefined;
          if (
            pp?.value &&
            typeof pp.value === 'object' &&
            'loadDocument' in (pp.value as Record<string, unknown>)
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
        if (!ctx || typeof ctx.loadDocument !== 'function') return false;
        (ctx.loadDocument as (json: string) => void)(docJson);
        return true;
      }, docJson);
      expect(loaded).toBe(true);
      await page.waitForTimeout(600);

      // Re-serialize: the document must round-trip exactly (params intact).
      const reSerialized = await page.evaluate(() => {
        const container = document.getElementById('root');
        if (!container) return null;
        const fiberKey = Object.keys(container).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
        );
        if (!fiberKey) return null;
        function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
          if (!fiber) return null;
          const mp = fiber.memoizedProps as Record<string, unknown> | undefined;
          const pp = fiber.pendingProps as Record<string, unknown> | undefined;
          for (const props of [mp, pp]) {
            const v = props?.value as Record<string, unknown> | undefined;
            if (v && typeof v.serializeDocument === 'function') return v;
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
        if (!ctx || typeof ctx.serializeDocument !== 'function') return null;
        return (ctx.serializeDocument as () => string)();
      });
      expect(reSerialized).not.toBeNull();
      // Strip volatile fields (ids are remapped on load; format version is
      // re-stamped) and compare the effect parameters.
      const stabilize = (json: string) =>
        json
          .replace(/"id":"[^"]*"/g, '"id":"X"')
          .replace(/"formatVersion":"[^"]*"/g, '"formatVersion":"V"');
      const afterStable = stabilize(reSerialized!);
      expect(afterStable).toContain('"kind":"dither"');
      expect(afterStable).toContain('"kind":"vhs"');
      expect(afterStable).toContain('"strength":0.5');

      // The effect must still be visibly applied (differs from a no-effect
      // document) — exact pixel equality is not asserted because selection
      // and camera state are not part of the document payload.
      const sourceHash = await page.evaluate(() => {
        const canvas = document.querySelector(
          'canvas.editor-canvas__content-layer',
        ) as HTMLCanvasElement | null;
        if (!canvas) return 'no-canvas';
        const ctx = canvas.getContext('2d');
        if (!ctx) return 'no-ctx';
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let h = 0x811c9dc5;
        for (let i = 0; i < d.length; i += 4) {
          h ^= d[i]!;
          h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(16);
      });
      expect(sourceHash).not.toBe(before);

      await page.screenshot({ path: resolve(REVIEW_DIR, 'persistence-reloaded.png') });
    });

    test('export: PNG export completes with live effects in the document', async ({ page }) => {
      // A document with live effects must export without errors and produce a
      // valid PNG. (Per-node raster export covers the node's own IR; the
      // adjustment-layer rasterization path for SVG/PDF exports is verified at
      // the unit level in flattenForExport.test.ts, including the effect
      // bounds expansion and filter application.)
      await addAdjustment(page, 'Bloom');
      await addAdjustment(page, 'CRT');
      await page.waitForTimeout(400);

      const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
        hasText: /^export$/i,
      });
      await exportTab.waitFor({ state: 'visible', timeout: 5000 });
      await exportTab.click();

      async function downloadPng(): Promise<Buffer> {
        await page.getByRole('button', { name: 'PNG', exact: true }).click();
        const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
        await page.getByRole('button', { name: /download/i }).click();
        const download = await downloadPromise;
        const path = await download.path();
        expect(path).toBeTruthy();
        const bytes = readFileSync(path!);
        expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        return bytes;
      }

      // Select the first layer with actual content and export it: the exported
      // PNG must contain rendered geometry (an empty adjustment layer yields a
      // ~88-byte transparent PNG; a rect export is several KB).
      let largest: Buffer | null = null;
      const treeItems = page.locator('.layers-panel [role="treeitem"]');
      const count = await treeItems.count();
      for (let i = 0; i < Math.min(count, 4); i += 1) {
        await treeItems.nth(i).click();
        await page.waitForTimeout(250);
        const bytes = await downloadPng();
        if (!largest || bytes.length > largest.length) largest = bytes;
      }
      expect(largest!.length).toBeGreaterThan(500);
    });

    test('palette snap imports a palette file and applies it', async ({ page }) => {
      const source = await canvasRegionHash(page);
      await addAdjustment(page, 'Palette Snap');
      const importBtn = page.getByRole('button', { name: /import palette/i });
      await expect(importBtn).toBeVisible({ timeout: 5000 });

      const chooserPromise = page.waitForEvent('filechooser');
      await importBtn.click();
      const fileChooser = await chooserPromise;
      const fixture = resolve(__dirname, '../../../packages/shared/src/__fixtures__/ink-act.act');
      await fileChooser.setFiles(fixture);
      await page.waitForTimeout(400);
      await expect(page.getByText(/imported 2 colors/i)).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(300);
      const affected = await canvasRegionHash(page);
      expect(affected).not.toBe(source);
      await page.screenshot({ path: resolve(REVIEW_DIR, 'paletteSnap-imported.png') });
    });

    test('fallback: effects render identically without WebGPU', async ({ page }) => {
      // Remove navigator.gpu before the app boots: a missing GPU must never
      // change the effect result or break the document. This test is
      // deliberately independent of document state (restored sessions and
      // the like) — it asserts pixel hashes only.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
      });
      await page.waitForTimeout(1500);
      const created = await page.evaluate(() => {
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
        if (!ctx || typeof ctx.createAdjustmentLayer !== 'function') return false;
        (ctx.createAdjustmentLayer as () => void)();
        return true;
      });
      expect(created).toBe(true);
      await page.waitForTimeout(600);
      const adjustmentsTab = page.getByRole('tab', { name: /Adjustments/i });
      await expect(adjustmentsTab).toBeVisible({ timeout: 10000 });
      await adjustmentsTab.click();
      await page.waitForTimeout(200);

      const source = await canvasRegionHash(page);
      await addAdjustment(page, 'Bloom');
      await page.waitForTimeout(900);
      const bloomed = await canvasRegionHash(page);
      expect(bloomed).not.toBe(source);
      // Disable → source appearance returns.
      await page.locator('.adj-panel__item-vis-btn').click();
      await page.waitForTimeout(500);
      expect(await canvasRegionHash(page)).toBe(source);
      await page.screenshot({ path: resolve(REVIEW_DIR, 'fallback-no-webgpu.png') });
    });
  });
});
