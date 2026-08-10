/**
 * File thumbnail workflow E2E — the user-facing loop for choosing what
 * represents a design:
 *
 *   1. create/open a design
 *   2. draw canvas artwork (rect) + a frame
 *   3. select the frame → layers context menu → "Use Frame as File Thumbnail"
 *   4. save
 *   5. return Home (in-app, Ctrl+Shift+H) → the chosen representation renders
 *   6. reopen, delete the source frame, save
 *   7. Home still shows a thumbnail (missing source falls back to automatic)
 *   8. reopen → File menu → Set File Thumbnail… → Reset → Apply → save
 *   9. Home updates (automatic again)
 *
 * Persistence across a full browser reload is exercised at the platform
 * level by unit/integration suites; this web e2e build intentionally runs
 * on the in-memory platform (createWebPlatform is not wired in the web
 * build), so cross-reload assertions would test the platform choice, not
 * the thumbnail system. In-app navigation keeps the platform session alive.
 */

import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * The web build's save flow (save coordinator) asks for a destination via
 * the File System Access API. Stub it deterministically so the first Save
 * adopts a target and subsequent saves reuse it (same contract as
 * tests/e2e/save/save-flow.spec.ts).
 */
async function installSavePickerStub(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    win.showSaveFilePicker = async () => ({
      name: 'document.varve',
      queryPermission: async () => 'granted',
      createWritable: async () => ({
        write: async () => undefined,
        close: async () => undefined,
      }),
    });
  });
}

/** Drag on the canvas in CLIENT coordinates (offset from the canvas box). */
async function dragClient(
  page: import('@playwright/test').Page,
  box: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 3 });
  await page.mouse.up();
}

/** Wait until the file grid's card has a rendered thumbnail image. */
async function expectCardThumbnail(page: import('@playwright/test').Page) {
  // The test session has exactly one file; its display name may be adopted
  // from the save picker's suggested name, so match the card structurally.
  const card = page.locator('.file-card').first();
  await card.waitFor({ timeout: 20000 });
  const img = card.locator('.varve-thumbnail__img');
  await expect(img).toBeVisible({ timeout: 30000 });
  // A real data-URL thumbnail, not a placeholder state.
  const src = await img.getAttribute('src');
  expect(src).toBeTruthy();
  expect(src).toMatch(/^data:image\/(png|webp)/);
  expect(src!.length).toBeGreaterThan(2000);
}

async function reopenFile(page: import('@playwright/test').Page) {
  // The editor session stays mounted behind Home; the app resumes it via
  // the sidebar button (the file-open path dedupes the same id).
  await page.getByRole('button', { name: /continue editing/i }).click({ timeout: 10000 });
  await page.locator('.layers-panel').waitFor({ state: 'visible', timeout: 30000 });
}

test.describe('file thumbnail workflow', () => {
  test('set a frame as the file thumbnail, fall back, reset', async ({ page }) => {
    await installSavePickerStub(page);
    // 1. Create a design.
    await navigateToEditor(page);

    // 2. Draw canvas artwork: a rect plus a frame.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = (await canvas.boundingBox())!;
    const statusBar = page.locator('[class*="status"]').last();
    await page.keyboard.press('r');
    await dragClient(page, box, { x: 40, y: 40 }, { x: 160, y: 120 });
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    await page.keyboard.press('f');
    await dragClient(page, box, { x: 220, y: 40 }, { x: 640, y: 360 });
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 15000 });

    // 3. Select the frame row, open its context menu with the keyboard
    //    (Shift+F10) and choose "Use Frame as File Thumbnail".
    await page.getByRole('treeitem').first().click({ timeout: 10000 });
    await expect(statusBar).toContainText(/frame/i, { timeout: 10000 });
    await page.keyboard.press('Shift+F10');
    const ctx = page.getByRole('menu').last();
    await expect(ctx).toBeVisible({ timeout: 10000 });
    await ctx.getByRole('menuitem', { name: /use frame as file thumbnail/i }).click({
      timeout: 10000,
    });
    await expect(
      page.locator('.varve-toast__message', { hasText: /file thumbnail now shows the frame/i }),
    ).toBeVisible({ timeout: 10000 });

    // 4. Save.
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(2000);

    // 5. Return Home in-app — the chosen representation must render.
    await page.keyboard.press('Control+Shift+H');
    await page.waitForSelector('.varve-home', { timeout: 20000 });
    await expectCardThumbnail(page);

    // 6. Reopen, delete the source frame, save.
    await reopenFile(page);
    await page.getByRole('treeitem').first().click({ timeout: 10000 });
    await page.keyboard.press('Delete');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(2000);

    // 7. Home still shows a thumbnail (missing source → automatic fallback).
    await page.keyboard.press('Control+Shift+H');
    await page.waitForSelector('.varve-home', { timeout: 20000 });
    await expectCardThumbnail(page);

    // 8. Reopen and reset through the File menu → picker dialog.
    await reopenFile(page);
    await page.getByRole('menuitem', { name: /^file$/i }).click({ timeout: 10000 });
    await page.getByRole('menuitem', { name: /set file thumbnail/i }).click({ timeout: 10000 });
    const picker = page.getByRole('dialog');
    await expect(picker).toBeVisible({ timeout: 10000 });
    await picker.getByRole('button', { name: /reset to automatic/i }).click();
    await picker.getByRole('button', { name: /^apply$/i }).click({ timeout: 10000 });
    await expect(picker.getByText(/thumbnail saved/i)).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden({ timeout: 10000 });
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(2000);

    // 9. Home updates — the automatic thumbnail still renders.
    await page.keyboard.press('Control+Shift+H');
    await page.waitForSelector('.varve-home', { timeout: 20000 });
    await expectCardThumbnail(page);
  });
});
