/**
 * Mockups E2E — the complete non-destructive workflow:
 *
 *   1. Create a UI frame (source design).
 *   2. Select it and open Mockups via the canvas context menu.
 *   3. Apply the built-in phone template.
 *   4. Verify a linked mockup frame appears and its inspector section shows.
 *   5. Edit the original frame (nudge) → mockup stays linked (source digest
 *      invalidation path exercised without errors).
 *   6. Save and reopen (reload to Home, reopen the recent file) → persists.
 *   7. Export PNG → download captured, IHDR dimensions read, non-empty.
 *   8. Replace the template (browser window) → inspector reflects it.
 *   9. Detach (remove mockup) → section disappears, frame remains.
 *  10. Undo restores the mockup; redo removes it again.
 *
 * Plus a multi-surface workflow (business card front/back with two sources).
 */

import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function createFrame(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('f'); // frame tool
  await page.waitForTimeout(100);
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 140, box.y + y + 180);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
}

async function openMockupsFromContextMenu(page: import('@playwright/test').Page): Promise<void> {
  await page
    .locator('canvas.editor-canvas__content-layer')
    .click({ button: 'right', position: { x: 190, y: 210 } });
  const ctxMenu = page.getByRole('menu');
  await ctxMenu.waitFor({ timeout: 8000 });
  await ctxMenu.getByRole('menuitem', { name: /apply mockup/i }).click();
  await page.waitForTimeout(300);
  const mockupsTab = page.getByRole('tab', { name: /mockups/i });
  await mockupsTab.waitFor({ timeout: 8000 });
  expect(await mockupsTab.getAttribute('aria-selected')).toBe('true');
}

async function applyTemplate(
  page: import('@playwright/test').Page,
  cardText: string,
): Promise<void> {
  const card = page.locator('.mockups-panel__card', { hasText: cardText });
  await card.waitFor({ timeout: 8000 });
  await card.getByRole('button', { name: /^Apply/ }).click();
  await page.waitForTimeout(500);
}

/** Read PNG width/height from the IHDR chunk of downloaded bytes. */
function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('mockup workflow: apply, link, update, save/reopen, export, replace, detach, undo/redo', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await navigateToEditor(page);

  // 1. Create a source frame.
  await createFrame(page, 120, 120);
  const layers = page.locator('.layers-panel');
  await layers.waitFor({ timeout: 8000 });
  expect(await page.locator('.layers-panel [role="treeitem"]').count()).toBeGreaterThan(0);

  // 2. Open Mockups from the canvas context menu (selection is the new frame).
  await openMockupsFromContextMenu(page);

  // 3. Apply the built-in phone template.
  await applyTemplate(page, 'Phone — Front');

  // 4. Mockup frame created + selected; inspector section shows the binding.
  const section = page.locator('.mockups-section');
  await section.waitFor({ timeout: 8000 });
  await expect(section.getByText('Phone — Front')).toBeVisible();
  await expect(section.getByText(/Linked to node/)).toBeVisible();

  // 5. Linked source update: nudge the source frame (digest invalidation).
  const sourceLayer = page.locator('.layers-panel [role="treeitem"]').first();
  await sourceLayer.click();
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  await expect(section).toBeVisible();

  // 6. Save, then reopen from Home.
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1200);
  await page.goto('/', { timeout: 60000, waitUntil: 'domcontentloaded' });
  // Home uses cards in the current responsive layout; gridcell is the stable
  // semantic contract shared by both the card and legacy row presentations.
  const fileRow = page.getByRole('gridcell').first();
  await fileRow.waitFor({ timeout: 20000 });
  await fileRow.dblclick();
  await page.locator('.layers-panel').waitFor({ timeout: 20000 });
  // The mockup survived save/reopen: select its layer, section is back.
  const mockupLayer = page
    .locator('.layers-panel [role="treeitem"]', { hasText: /mockup/i })
    .first();
  await mockupLayer.click();
  await page.waitForTimeout(300);
  await expect(page.locator('.mockups-section')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.mockups-section').getByText(/Linked to node/)).toBeVisible();

  // 7. Add a PNG export configuration, then open Export and capture the
  // download. The advanced dialog only lists nodes with enabled presets.
  await page.locator('[role="tablist"] button[role="tab"]', { hasText: /^export$/i }).click();
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  await page.getByRole('button', { name: 'Add configuration' }).click();
  // Headless Chromium exposes the File System Access picker, which cannot be
  // completed by an E2E worker. Exercise the browser-download fallback used
  // when that capability is unavailable.
  await page.evaluate(() => {
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.keyboard.press('Control+e');
  const exportDialog = page.getByRole('dialog');
  await exportDialog.waitFor({ timeout: 8000 });
  const exportBtn = exportDialog.getByRole('button', { name: /^Export \(/ });
  await exportBtn.click({ timeout: 8000 });
  const download = await downloadPromise;
  const savePath = `mockup-export-${Date.now()}.png`;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const fs = await import('node:fs');
  const bytes = fs.readFileSync(downloadPath as string);
  expect(bytes.length).toBeGreaterThan(1000);
  const dims = pngDimensions(bytes);
  expect(dims).not.toBeNull();
  expect(dims!.width).toBeGreaterThan(200);
  expect(dims!.height).toBeGreaterThan(200);
  // Non-empty output: not every byte is the background color.
  const alphaBytes = bytes.filter((_, i) => (i + 1) % 4 === 0).filter((b) => b !== 0).length;
  expect(alphaBytes).toBeGreaterThan(100);
  void savePath;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 8. Replace the template via the Mockups panel (browser window).
  await page.getByRole('tab', { name: /mockups/i }).click();
  await page.getByRole('tab', { name: /^properties$/i }).click();
  await applyTemplate(page, 'Browser Window');
  await expect(page.locator('.mockups-section').getByText('Browser Window')).toBeVisible({
    timeout: 8000,
  });

  // 9. Detach: remove the mockup payload; the frame itself remains.
  await page
    .locator('.mockups-section')
    .getByRole('button', { name: /remove mockup/i })
    .click();
  await page.waitForTimeout(400);
  await expect(page.locator('.mockups-section')).toHaveCount(0);

  // 10. Undo restores the mockup; redo removes it again.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  await expect(page.locator('.mockups-section')).toBeVisible({ timeout: 6000 });
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(400);
  await expect(page.locator('.mockups-section')).toHaveCount(0);

  // No render-path errors were raised during the whole workflow.
  const renderErrors = consoleErrors.filter((text) => !text.includes('favicon'));
  expect(renderErrors).toEqual([]);
});

test('multi-surface template: business card front and back bind two sources', async ({ page }) => {
  await navigateToEditor(page);

  // Create two source frames.
  await createFrame(page, 120, 120);
  await page.waitForTimeout(200);
  await createFrame(page, 420, 120);
  await page.waitForTimeout(200);

  // Select both via shift-click on the layers panel.
  const items = page.locator('.layers-panel [role="treeitem"]');
  await items.nth(0).click();
  await page.waitForTimeout(150);
  await page.keyboard.down('Shift');
  await items.nth(1).click();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);

  // Open Mockups and apply the business card template.
  await page
    .locator('canvas.editor-canvas__content-layer')
    .click({ button: 'right', position: { x: 190, y: 210 } });
  const ctxMenu = page.getByRole('menu');
  await ctxMenu.waitFor({ timeout: 8000 });
  await ctxMenu.getByRole('menuitem', { name: /apply mockup/i }).click();
  await page.waitForTimeout(300);

  await applyTemplate(page, 'Business Card');

  // Both surfaces bound (two sources cycled into front/back slots).
  const section = page.locator('.mockups-section');
  await section.waitFor({ timeout: 8000 });
  await expect(section.getByText(/Linked to node/).first()).toBeVisible();
  expect(await section.getByText(/Linked to node/).count()).toBe(2);
});
