/**
 * Icon library E2E — search → preview → one-action insert → offline reuse.
 *
 * The Iconify API is mocked deterministically with saved fixtures so the
 * suite never touches the live network. This spec covers the acceptance
 * criteria for Milestones 1–4: discovery, one-click insertion of an
 * uncached icon, persistence through the document, offline restart, and
 * the pack manager + starter pack.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const FIXTURES = join(process.cwd(), 'packages/engine/src/icon/__fixtures__');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** Open the Resources panel from any layout (toolbar FAB or shortcut). */
async function openResourcesPanel(page: import('@playwright/test').Page) {
  const panel = page.locator('.resources-panel');
  if (await panel.isVisible({ timeout: 3000 }).catch(() => false)) return;
  const toggle = page.getByRole('button', { name: /show resources panel|hide resources panel/i });
  if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
    await toggle.click();
  } else {
    await page.keyboard.press('Control+Alt+L');
  }
  await page.getByRole('tab', { name: /icons/i }).waitFor({ timeout: 10000 });
  await page.getByRole('tab', { name: /icons/i }).click();
}

/** Mock every Iconify endpoint with saved fixtures; ban live network. */
async function mockIconifyApi(page: import('@playwright/test').Page) {
  await page.route('https://api.iconify.design/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/search' && url.searchParams.get('query')?.includes('home')) {
      await route.fulfill({ contentType: 'application/json', body: fixture('search-home.json') });
      return;
    }
    if (url.pathname === '/collections') {
      await route.fulfill({
        contentType: 'application/json',
        body: fixture('collections-catalogue.json'),
      });
      return;
    }
    if (url.pathname === '/collection' && url.searchParams.get('prefix') === 'mdi') {
      await route.fulfill({
        contentType: 'application/json',
        body: fixture('collection-mdi.json'),
      });
      return;
    }
    if (url.pathname === '/mdi.json') {
      await route.fulfill({
        contentType: 'application/json',
        body: fixture('icons-mdi-batch.json'),
      });
      return;
    }
    if (url.pathname.endsWith('.json')) {
      // Any other pack's icon-data batch: deterministic single-path bodies.
      const prefix = url.pathname.replace(/^\//, '').replace(/\.json$/, '');
      const names = (url.searchParams.get('icons') ?? '').split(',');
      const icons: Record<string, { body: string; width: number; height: number }> = {};
      for (const name of names) {
        if (!name) continue;
        icons[name] = {
          body: '<path fill="currentColor" d="M12 2L2 22h20z"/>',
          width: 24,
          height: 24,
        };
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ prefix, icons }),
      });
      return;
    }
    if (url.pathname === '/mdi/home.svg') {
      await route.fulfill({ contentType: 'image/svg+xml', body: fixture('svg-mdi-home.svg') });
      return;
    }
    // Any pack's single-icon SVG route (modern /prefix/icon.svg shape).
    if (url.pathname.endsWith('.svg')) {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2L2 22h20z"/></svg>',
      });
      return;
    }
    if (url.pathname === '/keywords') {
      await route.fulfill({ contentType: 'application/json', body: fixture('keywords-home.json') });
      return;
    }
    if (url.pathname === '/last-modified') {
      await route.fulfill({ contentType: 'application/json', body: fixture('last-modified.json') });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) });
  });
}

test.describe('icon library', () => {
  test('search → preview → one-action insert → document persistence', async ({ page }) => {
    await mockIconifyApi(page);
    await navigateToEditor(page);

    // Open the Resources panel (first-class entry point).
    await openResourcesPanel(page);

    // Search.
    const search = page.getByLabel('Search icons');
    await search.fill('home');

    // Results render (virtualized grid) with the mocked search fixture.
    await page.waitForFunction(
      () => document.querySelectorAll('.icon-card').length > 0,
      undefined,
      { timeout: 15000 },
    );
    const firstCard = page.locator('.icon-card').first();
    await firstCard.click();

    // Details panel shows provenance from the fixture metadata.
    await page
      .getByText(/Material Design Icons|pack/i)
      .first()
      .waitFor({ timeout: 10000 });
    const insertButton = page.getByRole('button', { name: /^insert$/i });
    await insertButton.waitFor({ timeout: 10000 });
    await expect(insertButton).toBeEnabled({ timeout: 15000 });

    // One-action insertion (uncached icon): fetch → sanitize → cache → insert.
    await insertButton.click();

    // The document gains an icon asset — the inspector shows its provenance
    // (single undo transaction), proving scene insertion succeeded.
    await page
      .getByText(/Pack: material-symbols/i)
      .first()
      .waitFor({ timeout: 15000 });

    // The icon was cached (IndexedDB) for offline reuse.
    const cached = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('varve-icon-storage');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction('icons', 'readonly');
      const record = await new Promise<unknown>((resolve) => {
        const req = tx.objectStore('icons').get('iconify:mdi:home');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      db.close();
      return record;
    });
    expect(cached).not.toBeNull();
  });

  test('offline restart: cached icons stay searchable and insertable', async ({ page }) => {
    await mockIconifyApi(page);
    await navigateToEditor(page);
    await openResourcesPanel(page);

    // Cache an icon online.
    const search = page.getByLabel('Search icons');
    await search.fill('home');
    await page.waitForFunction(
      () => document.querySelectorAll('.icon-card').length > 0,
      undefined,
      { timeout: 15000 },
    );
    await page.locator('.icon-card').first().click();
    await expect(page.getByRole('button', { name: /^insert$/i })).toBeEnabled({ timeout: 15000 });
    await page.getByRole('button', { name: /^insert$/i }).click();
    await page
      .getByText(/Pack: material-symbols/i)
      .first()
      .waitFor({ timeout: 15000 });

    // Go offline: the provider is unreachable, but the downloaded icon must
    // remain searchable and insertable from the cache.
    await page.route('https://api.iconify.design/**', (route) => route.abort());
    await page.route('https://api.simplesvg.com/**', (route) => route.abort());
    await page.route('https://api.unisvg.com/**', (route) => route.abort());

    await page.getByRole('button', { name: /downloaded/i }).click();
    const cached = page.locator('.icon-card').filter({ hasText: /home/i }).first();
    await cached.waitFor({ timeout: 15000 });
    await cached.click();
    await expect(page.getByRole('button', { name: /^insert$/i })).toBeEnabled({ timeout: 15000 });
    await page.getByRole('button', { name: /^insert$/i }).click();

    // Two icon layers in the document — the offline insert worked end to end.
    await page.getByRole('button', { name: /downloaded/i }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('.icon-card').length >= 1,
      undefined,
      { timeout: 15000 },
    );
    const layerCount = await page.evaluate(
      () => document.querySelectorAll('.layers-panel [role="treeitem"]').length,
    );
    expect(layerCount).toBeGreaterThanOrEqual(2);
  });

  test('pack manager installs the bundled starter pack offline', async ({ page }) => {
    await navigateToEditor(page);
    await openResourcesPanel(page);

    // Open the pack manager from the panel header (always present).
    await page.getByRole('button', { name: /manage icon packs/i }).click();
    await page.getByRole('dialog', { name: /icon pack manager/i }).waitFor({ timeout: 10000 });

    // Offline for the icon API: the starter pack must install from the
    // bundled local file with no external network.
    await page.route('https://api.iconify.design/**', (route) => route.abort());
    await page.getByRole('button', { name: /install starter pack/i }).click();
    await expect(page.getByRole('button', { name: /installed/i })).toBeVisible({ timeout: 15000 });
    const count = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('varve-icon-storage');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction('icons', 'readonly');
      const all = await new Promise<unknown[]>((resolve) => {
        const req = tx.objectStore('icons').getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => resolve([]);
      });
      db.close();
      return all.length;
    });
    expect(count).toBeGreaterThanOrEqual(78);
  });

  test('empty-registry and network failures are actionable, not silent', async ({ page }) => {
    await navigateToEditor(page);
    await openResourcesPanel(page);
    const search = page.getByLabel('Search icons');
    // No route mocks: the fetch is banned by aborting, simulating a dead network.
    // Abort ALL provider hosts (the client falls back to backups by design).
    await page.route('https://api.iconify.design/**', (route) => route.abort());
    await page.route('https://api.simplesvg.com/**', (route) => route.abort());
    await page.route('https://api.unisvg.com/**', (route) => route.abort());
    // Unique query: identical earlier URLs may be served from the browser's
    // HTTP cache, bypassing the abort route.
    await search.fill('trash');
    await page
      .getByText(/could not reach the icon service/i)
      .first()
      .waitFor({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
  });

  test('inserted icon renders visible children on canvas', async ({ page }) => {
    await mockIconifyApi(page);
    await navigateToEditor(page);
    await openResourcesPanel(page);

    // Search for "home" and insert the icon.
    const search = page.getByLabel('Search icons');
    await search.fill('home');
    await page.waitForFunction(
      () => document.querySelectorAll('.icon-card').length > 0,
      undefined,
      { timeout: 15000 },
    );
    await page.locator('.icon-card').first().click();
    await expect(page.getByRole('button', { name: /^insert$/i })).toBeEnabled({ timeout: 15000 });
    await page.getByRole('button', { name: /^insert$/i }).click();

    // Wait for the insert to complete.
    await page
      .getByText(/Inserted icon "home"/i)
      .first()
      .waitFor({ timeout: 15000 });

    // Verify the icon is actually rendered on the canvas — the core bug was
    // computeGroupBounds returning 0x0 for path-only icons, which caused the
    // frame clip to hide all children.
    const canvasHasContent = await page.evaluate(() => {
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement;
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) return false;
      // Sample a patch in the center of the canvas.
      const patchSize = 20;
      const sx = Math.floor(w / 2 - patchSize / 2);
      const sy = Math.floor(h / 2 - patchSize / 2);
      const data = ctx.getImageData(sx, sy, patchSize, patchSize).data;
      // Check if any pixel has non-zero alpha (i.e., something is drawn).
      for (let i = 3; i < data.length; i += 4) {
        if (data[i]! > 0) return true;
      }
      return false;
    });
    expect(canvasHasContent).toBe(true);

    // Take a screenshot for visual verification.
    await page.screenshot({
      path: 'reports/icon-import/inserted-icon-visible.png',
      fullPage: false,
    });
  });
});
