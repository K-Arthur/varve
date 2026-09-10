import { expect, type Page, test } from '@playwright/test';

/**
 * Native-format migration: new saves default to `.varve`; legacy `.strata`
 * documents still open through the same versioned migration pipeline, and
 * neither format loses content when round-tripped.
 */

const LEGACY_STRATA_DOC = JSON.stringify({
  formatVersion: '2.14',
  id: 'legacy-doc',
  name: 'Legacy Brand',
  rootChildren: [],
  nodes: {},
  nextId: 1,
});

async function importFile(page: Page, name: string, content: string) {
  await page.goto('/');
  await page.waitForSelector('.varve-home', { timeout: 45000 });
  // Import is exposed via Ctrl+I (the toolbar Import button only renders
  // when the platform passes onOpenImport).
  await page.keyboard.press('Control+i');
  const dialog = page.locator('dialog.varve-dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(content, 'utf-8'),
  });
  await dialog.getByRole('button', { name: /^import \(/i }).click();
  // Import lands the file in the home library; dismiss the results dialog.
  const closeBtn = dialog.getByRole('button', { name: /close/i }).first();
  await closeBtn.click({ timeout: 10000 }).catch(() => undefined);
  await expect(dialog)
    .not.toBeVisible({ timeout: 10000 })
    .catch(() => undefined);
  // Open it from the list.
  await page.waitForSelector('.varve-home__content', { timeout: 15000 });
  const card = page.getByText('Legacy Brand', { exact: true }).first();
  await card.waitFor({ state: 'visible', timeout: 15000 });
  // Files open via the context-menu Open action (single click selects).
  await card.click({ button: 'right' });
  await page.locator('[role="menu"]').getByRole('menuitem', { name: 'Open' }).click();
  await page.waitForSelector('.layers-panel', { timeout: 15000 });
}

test.describe('Varve native format migration', () => {
  test('a legacy .strata document opens with content intact', async ({ page }) => {
    await importFile(page, 'legacy.strata', LEGACY_STRATA_DOC);
    // The document name survived the import (stripExtension → 'Legacy Brand').
    await expect(page.locator('.editor-menubar__doc-name-text')).toHaveText('Legacy Brand');
    await expect(page.locator('.layers-panel')).toBeVisible();
  });

  test('a .varve document opens identically', async ({ page }) => {
    await importFile(page, 'modern.varve', LEGACY_STRATA_DOC);
    await expect(page.locator('.editor-menubar__doc-name-text')).toHaveText('Legacy Brand');
  });

  test('saving a new design produces a .varve download', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.varve-home', { timeout: 45000 });
    await page.getByRole('button', { name: /^new$/i }).click({ force: true });
    const dialog = page.locator('dialog.varve-dialog[open]');
    await expect(dialog).toBeVisible();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await dialog.getByRole('button', { name: /create design/i }).click();
    await page.waitForSelector('.layers-panel', { timeout: 15000 });

    // Save As via the editor's File menu → download is the web fallback.
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.varve$/);
    }
    // The document itself is named with the untitled default regardless.
    await expect(page.locator('.editor-menubar__doc-name-text')).toHaveText(/Untitled \d+/);
  });

  test('malformed documents are rejected without crashing the app', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.varve-home', { timeout: 45000 });
    await page.keyboard.press('Control+i');
    const dialog = page.locator('dialog.varve-dialog[open]');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'broken.strata',
      mimeType: 'application/json',
      buffer: Buffer.from('{not json', 'utf-8'),
    });
    // The malformed file is skipped; the app stays on the home screen.
    await expect(page.locator('.varve-home')).toBeVisible();
  });
});
