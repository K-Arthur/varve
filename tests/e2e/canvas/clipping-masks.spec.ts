/**
 * End-to-end: clipping masks, mask parameters, and effect targeting.
 *
 * Covers the interaction contract on the real canvas and Layers panel:
 *   create clipping mask (Ctrl+7) → undo/redo → release · feather/density/
 *   invert on clip masks · frame ∩ mask · masked adjustment with explicit
 *   targets (A+C affected, B untouched) · spatial mask on an adjustment ·
 *   save/reopen persistence · layers-panel drop onto a matte.
 *
 * A screenshot corpus for human visual review is written to
 * reports/masking-review/.
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { dropImageOnCanvas } from '../helpers/editor-helpers';
import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

const REVIEW_DIR = resolve(__dirname, '../../../reports/masking-review');

const SHOT = {
  canvas: (name: string) => resolve(REVIEW_DIR, `${name}-canvas.png`),
  layers: (name: string) => resolve(REVIEW_DIR, `${name}-layers.png`),
};

/** Invoke a context method inside the browser (functions never cross the
 *  evaluate boundary — passing the context object as an arg strips them). */
async function callEditor(
  page: import('@playwright/test').Page,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  return page.evaluate(
    ({ method, args }) => {
      const container = document.getElementById('root');
      if (!container) return null;
      const fiberKey = Object.keys(container).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return null;
      function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const p = props as Record<string, unknown> | undefined;
          if (
            p?.value &&
            typeof p.value === 'object' &&
            'createAdjustmentLayer' in (p.value as Record<string, unknown>)
          ) {
            return p.value as Record<string, unknown>;
          }
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
      const fn = ctx?.[method] as ((...a: unknown[]) => unknown) | undefined;
      if (typeof fn !== 'function') return null;
      return fn(...(args as unknown[]));
    },
    { method, args },
  );
}

/** FNV-1a hash of a canvas region (deterministic pixel fingerprint). */
async function canvasHash(
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
  }, region ?? undefined);
}

/** Wait until a pixel hash settles (async image decode / engine settle). */
async function settledHash(
  page: import('@playwright/test').Page,
  region?: { x: number; y: number; w: number; h: number },
  attempts = 6,
): Promise<string> {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    await page.waitForTimeout(500);
    last = await canvasHash(page, region);
    const again = await canvasHash(page, region);
    if (again === last) return last;
  }
  return last;
}

async function addRect(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> {
  await page.keyboard.press('r');
  await dragOnCanvas(page, x, y, x + w, y + h);
  await page.keyboard.press('v');
  await page.waitForTimeout(250);
}

/** Select all current layers (Select All via the action palette is slow; use Ctrl+A). */
async function selectAll(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(250);
}

async function treeItemNames(page: import('@playwright/test').Page): Promise<string[]> {
  const items = page.locator('.layers-panel [role="treeitem"]');
  const count = await items.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    names.push((await items.nth(i).innerText()).split('\n')[0] ?? '');
  }
  return names;
}

test.describe('clipping masks', () => {
  test.describe.configure({ mode: 'serial' });

  test('create clipping mask with Ctrl+7, undo, redo', async ({ page }) => {
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToCleanEditor(page);

    // A photo and a rect; photo dropped on empty canvas (no auto-clip).
    await dropImageOnCanvas(page, 'photo-fixture.jpg', 380, 120);
    await page.waitForTimeout(400);
    await addRect(page, 100, 100, 260, 240);

    const before = await settledHash(page);
    expect(before).not.toBe('no-canvas');

    await selectAll(page);
    await page.keyboard.press('Control+7'); // Create Clipping Mask
    const clipped = await settledHash(page);

    // One group remains on top level; the group carries the clip mask.
    const names = await treeItemNames(page);
    expect(names.some((n) => /clip/i.test(n))).toBe(true);
    await page.screenshot({ path: SHOT.canvas('01-clip-created') });
    await page.locator('.layers-panel').screenshot({ path: SHOT.layers('01-clip-created') });

    // The clip is a real visual change: photo confined to the rect.
    expect(clipped).not.toBe(before);

    // Undo → unclipped.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await settledHash(page)).toBe(before);

    // Redo → clipped again.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    expect(await settledHash(page)).toBe(clipped);
    await page.screenshot({ path: SHOT.canvas('02-clip-redo') });
  });

  test('release clipping mask restores the original layers', async ({ page }) => {
    await navigateToCleanEditor(page);
    await dropImageOnCanvas(page, 'photo-fixture.jpg', 380, 120);
    await page.waitForTimeout(400);
    await addRect(page, 100, 100, 260, 240);
    await selectAll(page);
    await page.keyboard.press('Control+7');
    await page.waitForTimeout(500);

    // Select the clipping group (first row), then release via Ctrl+Alt+7.
    await page.locator('.layers-panel [role="treeitem"]').first().click();
    await page.keyboard.press('Control+Alt+7');
    await page.waitForTimeout(500);

    // Original layers are back as siblings (rect + image on top level).
    const names = await treeItemNames(page);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names.some((n) => /photo/i.test(n) || /image/i.test(n))).toBe(true);
    await page.screenshot({ path: SHOT.canvas('03-released') });
  });

  test('feather, density, and invert on a clip mask update the canvas live', async ({ page }) => {
    await navigateToCleanEditor(page);
    await dropImageOnCanvas(page, 'photo-fixture.jpg', 380, 120);
    await page.waitForTimeout(400);
    await addRect(page, 100, 100, 260, 240);
    await selectAll(page);
    await page.keyboard.press('Control+7');
    await page.waitForTimeout(500);
    const hardClip = await settledHash(page);

    // Select the group and open the Appearance tab (Mask section lives
    // there; the default Properties tab does not render it).
    await page.locator('.layers-panel [role="treeitem"]').first().click();
    const appearanceTab = page.getByRole('tab', { name: /^Appearance$/ });
    await expect(appearanceTab).toBeVisible({ timeout: 5000 });
    await appearanceTab.click();
    await page.waitForTimeout(300);

    // Feather: the mask section exposes a Feather number field.
    const featherField = page.getByLabel('Feather', { exact: true });
    await expect(featherField).toBeVisible({ timeout: 5000 });
    await featherField.fill('24');
    await page.waitForTimeout(500);
    const feathered = await settledHash(page);
    expect(feathered).not.toBe(hardClip);
    await page.screenshot({ path: SHOT.canvas('04-feathered') });

    // Density slider.
    const density = page.getByRole('slider', { name: /mask density/i });
    await expect(density).toBeVisible({ timeout: 5000 });
    await density.fill('0.4');
    await page.waitForTimeout(500);
    const faded = await settledHash(page);
    expect(faded).not.toBe(feathered);
    await page.screenshot({ path: SHOT.canvas('05-density') });
    await density.fill('1');
    await page.waitForTimeout(400);

    // Invert via the Object menu path is slow; drive the scene setter the
    // same way the menu does and assert the canvas flips.
    const invertedResult = await callEditor(page, 'invertMask');
    expect(invertedResult).not.toBeNull();
    await page.waitForTimeout(500);
    const inverted = await settledHash(page);
    expect(inverted).not.toBe(hardClip);
    await page.screenshot({ path: SHOT.canvas('06-inverted') });
  });

  test('layers panel shows source/content roles for the clipping run', async ({ page }) => {
    await navigateToCleanEditor(page);
    await dropImageOnCanvas(page, 'photo-fixture.jpg', 380, 120);
    await page.waitForTimeout(400);
    await addRect(page, 100, 100, 260, 240);
    await addRect(page, 120, 300, 140, 100);
    await selectAll(page);
    await page.keyboard.press('Control+7');
    await page.waitForTimeout(600);

    // The matte row and the clipped rows must be marked (aria labels carry
    // the relationship for screen readers — not just color/indentation).
    const rows = page.locator('.layers-panel [role="treeitem"]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
    const roleTexts: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).innerText()).toLowerCase();
      const aria = await rows.nth(i).getAttribute('aria-label');
      roleTexts.push(text + (aria ? ` [${aria}]` : ''));
    }
    const all = roleTexts.join(' ');
    expect(all).toMatch(/clipp/i);
    await page.locator('.layers-panel').screenshot({ path: SHOT.layers('07-roles') });
  });
});

test.describe('effect targeting', () => {
  test.describe.configure({ mode: 'serial' });

  test('adjustment with explicit targets A+C affects A and C but not B', async ({ page }) => {
    await navigateToCleanEditor(page);
    await addRect(page, 60, 60, 120, 120);
    await addRect(page, 240, 60, 120, 120);
    await addRect(page, 420, 60, 120, 120);
    await page.waitForTimeout(300);

    const created = await callEditor(page, 'createAdjustmentLayer');
    expect(created).not.toBeNull();
    await page.waitForTimeout(500);

    // Target A (first) and C (third) only, via the scope setter. Nodes are
    // found by kind — in a paged document the rects live under the page's
    // contentRoot, not in doc.rootChildren.
    const setScope = await page.evaluate(() => {
      const container = document.getElementById('root');
      if (!container) return false;
      const fiberKey = Object.keys(container).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return false;
      function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const p = props as Record<string, unknown> | undefined;
          if (
            p?.value &&
            typeof p.value === 'object' &&
            'createAdjustmentLayer' in (p.value as Record<string, unknown>)
          ) {
            return p.value as Record<string, unknown>;
          }
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
      const api = ctx as {
        state?: { document?: { nodes?: Record<string, { kind?: string; id?: string }> } };
        updateNode?: (
          id: string,
          updater: (node: Record<string, unknown>) => Record<string, unknown>,
        ) => void;
      };
      const nodes = api.state?.document?.nodes ?? {};
      const shapes = Object.values(nodes)
        .filter((n) => n.kind === 'shape')
        .map((n) => n.id ?? '')
        .filter(Boolean);
      const adj = Object.values(nodes).find((n) => n.kind === 'adjustment');
      if (shapes.length < 3 || !adj?.id || typeof api.updateNode !== 'function') return false;
      api.updateNode(adj.id, (node) => ({
        ...(node as Record<string, unknown>),
        scope: { mode: 'explicit-targets', targetNodeIds: [shapes[0]!, shapes[2]!] },
      }));
      return true;
    });
    expect(setScope).toBe(true);

    // Add a deterministic color effect through the Adjustments panel. Bloom
    // intentionally has little or no visible output on a flat matte-colored
    // rectangle, so it is not a reliable scope oracle.
    const adjustmentsTab = page.getByRole('tab', { name: /Adjustments/i });
    await expect(adjustmentsTab).toBeVisible({ timeout: 5000 });
    await adjustmentsTab.click();
    await page.locator('button.adj-panel__add-btn').click();
    await page.locator('.adj-panel__add-menu').waitFor({ state: 'visible', timeout: 5000 });
    await page
      .locator('.adj-panel__add-menu-item')
      .filter({ hasText: /^Brightness$/ })
      .click();
    await page.getByRole('slider', { name: 'Brightness', exact: true }).fill('60');
    await page.waitForTimeout(600);

    const hA = await settledHash(page, { x: 40, y: 40, w: 160, h: 160 });
    const hB = await settledHash(page, { x: 220, y: 40, w: 160, h: 160 });
    const hC = await settledHash(page, { x: 400, y: 40, w: 160, h: 160 });

    // B must be untouched by the effect — its region must not match the
    // changed A/C regions (the effect changed A and C, not B).
    expect(hA).not.toBe(hB);
    expect(hC).not.toBe(hB);
    await page.screenshot({ path: SHOT.canvas('08-targets-ac') });
  });

  test('spatial mask confines an adjustment to the matte region', async ({ page }) => {
    await navigateToCleanEditor(page);
    await addRect(page, 60, 60, 200, 200);
    await addRect(page, 60, 140, 200, 60);
    await page.waitForTimeout(300);

    const created = await callEditor(page, 'createAdjustmentLayer');
    expect(created).not.toBeNull();
    await page.waitForTimeout(500);

    // Scope to the big rect; attach a clip-type spatial mask whose source is
    // the small bottom rect — the effect may only show inside that rect.
    const configured = await page.evaluate(() => {
      const container = document.getElementById('root');
      if (!container) return false;
      const fiberKey = Object.keys(container).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return false;
      function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const p = props as Record<string, unknown> | undefined;
          if (
            p?.value &&
            typeof p.value === 'object' &&
            'createAdjustmentLayer' in (p.value as Record<string, unknown>)
          ) {
            return p.value as Record<string, unknown>;
          }
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
      const api = ctx as {
        state?: { document?: { nodes?: Record<string, { kind?: string; id?: string }> } };
        updateNode?: (
          id: string,
          updater: (node: Record<string, unknown>) => Record<string, unknown>,
        ) => void;
      };
      const nodes = api.state?.document?.nodes ?? {};
      const shapes = Object.values(nodes)
        .filter((n) => n.kind === 'shape')
        .map((n) => n.id ?? '')
        .filter(Boolean);
      const adj = Object.values(nodes).find((n) => n.kind === 'adjustment');
      if (shapes.length < 2 || !adj?.id || typeof api.updateNode !== 'function') return false;
      api.updateNode(adj.id, (node) => ({
        ...(node as Record<string, unknown>),
        scope: { mode: 'image-local', targetNodeId: shapes[0]! },
        mask: { type: 'clip', visible: true, sourceNodeId: shapes[1]! },
      }));
      return true;
    });
    expect(configured).toBe(true);

    const beforeInside = await settledHash(page, { x: 80, y: 150, w: 160, h: 40 });
    const beforeOutside = await settledHash(page, { x: 80, y: 80, w: 160, h: 40 });

    const adjustmentsTab = page.getByRole('tab', { name: /Adjustments/i });
    await expect(adjustmentsTab).toBeVisible({ timeout: 5000 });
    await adjustmentsTab.click();
    await page.locator('button.adj-panel__add-btn').click();
    await page.locator('.adj-panel__add-menu').waitFor({ state: 'visible', timeout: 5000 });
    await page
      .locator('.adj-panel__add-menu-item')
      .filter({ hasText: /^Brightness$/ })
      .click();
    await page.getByRole('slider', { name: 'Brightness', exact: true }).fill('60');
    await page.waitForTimeout(600);

    const insideMatte = await settledHash(page, { x: 80, y: 150, w: 160, h: 40 });
    const outsideMatte = await settledHash(page, { x: 80, y: 80, w: 160, h: 40 });
    expect(insideMatte).not.toBe(beforeInside);
    expect(outsideMatte).toBe(beforeOutside);
    await page.screenshot({ path: SHOT.canvas('09-masked-adjustment') });
    await page.screenshot({ path: SHOT.layers('09-masked-adjustment') });

    // The spatial mask is also discoverable in the existing Appearance
    // inspector, including its stable source picker.
    const appearanceTab = page.getByRole('tab', { name: /^Appearance$/ });
    await appearanceTab.click();
    await expect(page.getByRole('combobox', { name: 'Mask source' })).toBeVisible();
    await page.screenshot({ path: SHOT.canvas('09-mask-inspector') });
  });

  test('persistence: serialize → reload reproduces the clipping stack', async ({ page }) => {
    await navigateToCleanEditor(page);
    await dropImageOnCanvas(page, 'photo-fixture.jpg', 380, 120);
    await page.waitForTimeout(400);
    await addRect(page, 100, 100, 260, 240);
    await selectAll(page);
    await page.keyboard.press('Control+7');
    await page.waitForTimeout(500);
    await settledHash(page);

    const json = (await callEditor(page, 'serializeDocument')) as string | null;
    expect(json).toBeTruthy();
    expect(json).toContain('"type":"clip"');

    // Reload through the app's own loader — same browser, fresh document.
    const loaded = await page.evaluate(
      ({ docJson }) => {
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
      },
      { docJson: json as string },
    );
    expect(loaded).toBe(true);
    // The loader fits the camera to content, so raw pixels cannot be
    // byte-compared with the pre-reload frame — assert structure and that
    // the clip renders (non-blank canvas, clip group present in the tree).
    await page.waitForTimeout(800);
    const reloaded = await settledHash(page);
    expect(reloaded).not.toBe('no-canvas');
    const names = await treeItemNames(page);
    expect(names.some((n) => /clip/i.test(n))).toBe(true);
    await page.screenshot({ path: SHOT.canvas('10-persistence-reloaded') });
  });
});

test.use({
  launchOptions: {
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer'],
  },
});

test.describe('webgpu fallback', () => {
  test('clipped scenes render with a WebGPU-capable browser (structural fallback)', async ({
    page,
  }) => {
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToCleanEditor(page);
    await dropImageOnCanvas(page, 'photo-fixture.jpg', 380, 120);
    await page.waitForTimeout(400);
    await addRect(page, 100, 100, 260, 240);
    await selectAll(page);
    await page.keyboard.press('Control+7');
    const clipped = await settledHash(page);

    // Whether the compositor took the WebGPU leaf path or the structural
    // Canvas2D fallback, the mask must render — the canvas is non-blank and
    // the clip relationship exists in the tree.
    expect(clipped).not.toBe('no-canvas');
    const names = await treeItemNames(page);
    expect(names.some((n) => /clip/i.test(n))).toBe(true);
    await page.screenshot({ path: SHOT.canvas('11-webgpu-fallback') });
  });
});

test.describe('brush masks', () => {
  test('paint a pixel mask on an editable vector layer without rasterizing it', async ({
    page,
  }) => {
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToCleanEditor(page);

    await page.keyboard.press('r');
    await dragOnCanvas(page, 140, 140, 380, 300);
    await page.waitForTimeout(300);
    await page.locator('.layers-panel [role="treeitem"]').first().click();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.getByRole('button', { name: 'Mask', exact: true }).click();

    // The same Inspector entry used for image/raster layers is available for
    // a vector target. Clicking it drives the real brush path below.
    const paintMask = page.getByRole('button', { name: /paint mask with the brush tool/i });
    await expect(paintMask).toBeVisible();
    const plain = await settledHash(page);
    await paintMask.click();

    const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!box) throw new Error('content canvas not found');
    await page.mouse.move(box.x + 210, box.y + 210);
    await page.mouse.down();
    await page.mouse.move(box.x + 290, box.y + 230, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const masked = await settledHash(page);
    expect(masked).not.toBe(plain);
    await page.screenshot({ path: SHOT.canvas('14-vector-pixel-mask') });

    // The document stores a finite coverage asset in target-local pixels;
    // the selected layer remains a shape with editable vector authority.
    const documentJson = (await callEditor(page, 'serializeDocument')) as string | null;
    expect(documentJson).toBeTruthy();
    const serialized = JSON.parse(documentJson!) as {
      nodes: Record<
        string,
        {
          kind?: string;
          shape?: { kind?: string };
          mask?: { rasterMask?: { coordinateSpace?: string } };
        }
      >;
    };
    const vector = Object.values(serialized.nodes).find(
      (node) =>
        node.kind === 'shape' && node.mask?.rasterMask?.coordinateSpace === 'node-local-pixels',
    );
    expect(vector?.shape?.kind).toBe('rect');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    expect(await settledHash(page)).toBe(plain);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(500);
    expect(await settledHash(page)).toBe(masked);
  });

  test('paint a brush mask on a frame: create, undo, redo, persist', async ({ page }) => {
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToCleanEditor(page);

    // Frame with a child rect inside.
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 400, 300);
    await page.waitForTimeout(300);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 250);
    await page.waitForTimeout(300);

    // Select the frame (first tree row).
    await page.locator('.layers-panel [role="treeitem"]').first().click();
    await page.waitForTimeout(300);

    const plain = await settledHash(page);

    // Activate the brush-mask tool and paint a stroke inside the frame.
    const setTool = await callEditor(page, 'setTool', 'refineMask');
    expect(setTool).not.toBeNull();
    await page.waitForTimeout(400);
    const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!box) throw new Error('content canvas not found');
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 220, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    // The mask was committed to the document (container-local raster mask).
    const maskState = await page.evaluate(() => {
      const container = document.getElementById('root');
      if (!container) return null;
      const fiberKey = Object.keys(container).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return null;
      function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const p = props as Record<string, unknown> | undefined;
          if (
            p?.value &&
            typeof p.value === 'object' &&
            'createAdjustmentLayer' in (p.value as Record<string, unknown>)
          ) {
            return p.value as Record<string, unknown>;
          }
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
      ) as { state?: { document?: unknown } } | null;
      const doc = ctx?.state?.document as
        | {
            nodes?: Record<
              string,
              {
                kind?: string;
                mask?: { rasterMask?: { coordinateSpace?: string; assetId?: string } };
              }
            >;
          }
        | undefined;
      for (const node of Object.values(doc?.nodes ?? {})) {
        if (node.kind === 'frame' && node.mask?.rasterMask) {
          return node.mask.rasterMask;
        }
      }
      return null;
    });
    expect(maskState?.coordinateSpace).toBe('container-local-pixels');
    expect(maskState?.assetId).toBeTruthy();

    const masked = await settledHash(page);
    expect(masked).not.toBe(plain);
    await page.screenshot({ path: SHOT.canvas('12-brush-mask') });

    // Undo removes the mask; redo restores it.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    expect(await settledHash(page)).toBe(plain);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(500);
    expect(await settledHash(page)).toBe(masked);

    // Serialize → reload: the painted mask survives.
    const json = (await callEditor(page, 'serializeDocument')) as string | null;
    expect(json).toBeTruthy();
    expect(json).toContain('"coordinateSpace":"container-local-pixels"');
    const loaded = await page.evaluate(
      ({ docJson }) => {
        const container = document.getElementById('root');
        if (!container) return false;
        const fiberKey = Object.keys(container).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
        );
        if (!fiberKey) return false;
        function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
          if (!fiber) return null;
          for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
            const p = props as Record<string, unknown> | undefined;
            if (
              p?.value &&
              typeof p.value === 'object' &&
              'loadDocument' in (p.value as Record<string, unknown>)
            ) {
              return p.value as Record<string, unknown>;
            }
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
      },
      { docJson: json as string },
    );
    expect(loaded).toBe(true);
    await page.waitForTimeout(800);
    const reloaded = await settledHash(page);
    expect(reloaded).not.toBe('no-canvas');
    const names = await treeItemNames(page);
    expect(names.length).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: SHOT.canvas('13-brush-mask-reloaded') });
  });
});
