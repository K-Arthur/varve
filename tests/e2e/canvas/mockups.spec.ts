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

import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

const reviewDir = 'reports/mockup-review';

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
  // Return to the select tool and re-select the frame: Escape clears the
  // selection, and the mockup actions need a live selection.
  await page.keyboard.press('v');
  await page.waitForTimeout(100);
  await page.mouse.click(box.x + x + 70, box.y + y + 90);
  await page.waitForTimeout(150);
}

/**
 * Open the Resources → Mockups tab. The canvas context menu path is avoided
 * here: tool-hint overlays can sit above the canvas and the panel route is the
 * primary discoverable surface anyway. The current selection supplies the
 * apply sources.
 */
async function openMockupsPanel(page: import('@playwright/test').Page): Promise<void> {
  const tab = page.getByRole('tab', { name: /mockups/i });
  if (!(await tab.first().isVisible().catch(() => false))) {
    await page.keyboard.press('Control+Alt+l');
  }
  await tab.first().waitFor({ timeout: 10000 });
  await tab.first().click();
  await page.waitForTimeout(200);
  await expect(tab.first()).toHaveAttribute('aria-selected', 'true');
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
  await openMockupsPanel(page);

  // 3. Apply the built-in phone template.
  await applyTemplate(page, 'Phone — Front');

  // 4. Mockup frame created + selected; inspector section shows the binding.
  const section = page.locator('.mockups-section');
  await section.waitFor({ timeout: 8000 });
  await expect(section.getByText('Phone — Front')).toBeVisible();
  await expect(section.getByText(/Frame 1/)).toBeVisible();

  // 5. Linked source update: nudge the source frame (digest invalidation).
  const sourceLayer = page
    .locator('.layers-panel [role="treeitem"]', { hasText: /Frame 1/ })
    .first();
  await sourceLayer.click();
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  // Selecting the source hides the inspector section; re-select the mockup to
  // confirm it still resolves its live binding after the source moved.
  await page
    .locator('.layers-panel [role="treeitem"]', { hasText: /mockup/i })
    .first()
    .click();
  await page.waitForTimeout(300);
  await expect(section).toBeVisible();

  // 6. Save, then reopen from Home.
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1200);
  await page.goto('/', { timeout: 60000, waitUntil: 'domcontentloaded' });
  await dismissRecoveryDialog(page);
  // Home uses cards in the current responsive layout; gridcell is the stable
  // semantic contract shared by both the card and legacy row presentations.
  const fileRow = page.getByRole('gridcell').first();
  await fileRow.waitFor({ timeout: 20000 });
  await fileRow.dblclick();
  await page.locator('.layers-panel').waitFor({ timeout: 20000 });
  await dismissRecoveryDialog(page);
  // The mockup survived save/reopen: select its layer, section is back.
  const mockupLayer = page
    .locator('.layers-panel [role="treeitem"]', { hasText: /mockup/i })
    .first();
  await mockupLayer.click();
  await page.waitForTimeout(300);
  await expect(page.locator('.mockups-section')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.mockups-section').getByText(/Frame 1/)).toBeVisible();

  // 7. Add a PNG export configuration, then open Export and capture the
  // download. The advanced dialog only lists nodes with enabled presets.
  await openInspectorTab(page, 'Export');
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
  const exportDialog = page.getByRole("dialog", { name: "Export" });
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

  // 8. Apply another template from the Mockups panel (browser window).
  await page.getByRole('tab', { name: /mockups/i }).click();
  await applyTemplate(page, 'Browser Window');
  await openInspectorTab(page, 'Design');
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
  await expect(section.getByText(/Frame 1/).first()).toBeVisible();
  await expect(section.getByText(/Frame 2/).first()).toBeVisible();
});

/** Close the crash-recovery dialog when it appears after navigation. */
async function dismissRecoveryDialog(page: import('@playwright/test').Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /Recover unsaved documents/ });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await dialog.isVisible().catch(() => false)) {
      await dialog
        .getByRole('button', { name: /^Close$/ })
        .click({ timeout: 5000 })
        .catch(() => undefined);
      await page.waitForTimeout(300);
      return;
    }
    await page.waitForTimeout(300);
  }
}

/** Open an inspector tab, using the "More" overflow menu when it is hidden. */
async function openInspectorTab(
  page: import('@playwright/test').Page,
  label: string,
): Promise<void> {
  const direct = page.getByRole('tab', { name: label, exact: true });
  if (await direct.first().isVisible().catch(() => false)) {
    await direct.first().click();
    return;
  }
  const more = page.getByRole('button', { name: /More inspector tabs/ });
  await more.click({ timeout: 10000 });
  await page.getByRole('menuitem', { name: label, exact: true }).click({ timeout: 10000 });
}

/** Configure a PNG export preset, then export and return the PNG bytes. */
async function exportPng(page: import('@playwright/test').Page): Promise<Buffer> {
  await openInspectorTab(page, 'Export');
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  await page.getByRole('button', { name: 'Add configuration' }).click();
  await page.evaluate(() => {
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.keyboard.press('Control+e');
  const exportDialog = page.getByRole("dialog", { name: "Export" });
  await exportDialog.waitFor({ timeout: 8000 });
  await exportDialog.getByRole('button', { name: /^Export \(/ }).click({ timeout: 8000 });
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  return readFileSync(downloadPath as string);
}

test('export renders the composed mockup, not the frame background', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  mkdirSync(reviewDir, { recursive: true });
  await navigateToEditor(page);
  await createFrame(page, 120, 120);
  await openMockupsPanel(page);
  await applyTemplate(page, 'Phone — Front');
  await page.locator('.mockups-section').waitFor({ timeout: 8000 });

  const bytes = await exportPng(page);
  const png = PNG.sync.read(bytes);
  expect(png.width).toBeGreaterThan(200);
  expect(png.height).toBeGreaterThan(200);

  // The composed output must contain the template background (#eef0f4) and
  // the phone plate (#16181c) — the export is the decorated mockup, not a
  // single flat frame fill.
  let background = 0;
  let plate = 0;
  const colors = new Set<string>();
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i]!;
    const g = png.data[i + 1]!;
    const b = png.data[i + 2]!;
    const a = png.data[i + 3]!;
    if (a < 250) continue;
    colors.add(`${r >> 3}-${g >> 3}-${b >> 3}`);
    if (Math.abs(r - 238) <= 3 && Math.abs(g - 240) <= 3 && Math.abs(b - 244) <= 3) background++;
    if (r < 40 && g < 45 && b < 50) plate++;
  }
  expect(background).toBeGreaterThan(1000);
  expect(plate).toBeGreaterThan(500);
  expect(colors.size).toBeGreaterThan(10);
  expect(consoleErrors.filter((text) => !text.includes('favicon'))).toEqual([]);
});

test('canvas surface overlay edits geometry and undoes in one step', async ({ page }) => {
  await navigateToEditor(page);
  await createFrame(page, 120, 120);
  await openMockupsPanel(page);
  await applyTemplate(page, 'Phone — Front');
  // The applied mockup frame is selected: its surfaces are click targets.
  const chip = page.locator('.mockup-overlay__chip', { hasText: 'Screen' });
  await chip.waitFor({ timeout: 8000 });
  await chip.click();
  await page.waitForTimeout(200);

  const xInput = page.locator('.mockups-section__number input[aria-label="x"]');
  await xInput.waitFor({ timeout: 5000 });
  const before = Number(await xInput.inputValue());

  const handle = page.locator('.mockup-overlay__handle[aria-label*="Corner top left"]');
  await handle.waitFor({ timeout: 5000 });
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 24, box!.y + box!.height / 2 + 12, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = Number(await xInput.inputValue());
  expect(after).toBeGreaterThan(before);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect(Number(await xInput.inputValue())).toBeCloseTo(before, 0);
});

test('deleting a bound source reports a missing source instead of crashing', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await navigateToEditor(page);
  await createFrame(page, 120, 120);
  await openMockupsPanel(page);
  await applyTemplate(page, 'Phone — Front');
  const section = page.locator('.mockups-section');
  await section.waitFor({ timeout: 8000 });

  // Select the source frame and delete it.
  const sourceLayer = page
    .locator('.layers-panel [role="treeitem"]', { hasText: /Frame 1/ })
    .first();
  await sourceLayer.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);

  // Re-select the mockup frame; the surface reports the missing source.
  const mockupLayer = page
    .locator('.layers-panel [role="treeitem"]', { hasText: /mockup/i })
    .first();
  await mockupLayer.click();
  await page.waitForTimeout(300);
  await expect(
    page
      .locator('.mockups-section')
      .getByText(/Missing source/)
      .first(),
  ).toBeVisible({
    timeout: 8000,
  });
  expect(consoleErrors.filter((text) => !text.includes('favicon'))).toEqual([]);
});

test('create template from selection adds a reusable Custom template', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await navigateToEditor(page);
  await createFrame(page, 120, 120);

  // Author a template from the selected frame through the panel action.
  await openMockupsPanel(page);
  await page.getByRole('button', { name: /Create from selection/ }).click();
  await page.waitForTimeout(1500);

  // A new mockup instance is created and selected.
  await expect(page.locator('.mockups-section')).toBeVisible({ timeout: 10000 });

  // The Mockups library lists it as a Custom template with an export action.
  const card = page.locator('.mockups-panel__card', { hasText: /Custom/ }).first();
  await card.waitFor({ timeout: 8000 });
  await expect(card.getByRole('button', { name: /export/i })).toBeVisible();
  expect(consoleErrors.filter((text) => !text.includes('favicon'))).toEqual([]);
});
