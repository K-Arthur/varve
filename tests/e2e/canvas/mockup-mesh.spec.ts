/**
 * Mesh mockup E2E — the folded-fabric workflow:
 *
 *   1. Create a source frame, open Resources -> Mockups, apply
 *      "Fabric Banner - Folded" (builtin:fabric-banner-mesh).
 *   2. Verify the canvas actually paints the composed mockup (pixel sample).
 *   3. Select the fabric surface chip, drag a grid vertex, verify the
 *      override lands (inspector shows the edited state), undo restores the
 *      template default in one step.
 *   4. Save and reopen: the mesh override survives with the template.
 *   5. Export PNG through the real dialog; decode the download and check
 *      dimensions plus non-uniform content (folded artwork, not a flat
 *      rectangle).
 *
 * Evidence screenshots use isolated test output by default.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

const evidenceDir = 'mockup-mesh';

async function createFrame(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('f');
  await page.waitForTimeout(100);
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 160, box.y + y + 120);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.keyboard.press('v');
  await page.waitForTimeout(100);
  await page.mouse.click(box.x + x + 80, box.y + y + 60);
  await page.waitForTimeout(150);
}

async function openMockupsPanel(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: /mockups/i });
  if (
    !(await tab
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await page.keyboard.press('Control+Alt+l');
  }
  await tab.first().waitFor({ timeout: 10000 });
  await tab.first().click();
  await page.waitForTimeout(200);
  await expect(tab.first()).toHaveAttribute('aria-selected', 'true');
}

/** Open an inspector tab through the direct tab or the overflow menu. */
async function openInspectorTab(page: Page, label: string): Promise<void> {
  const direct = page.getByRole('tab', { name: label, exact: true });
  if (
    await direct
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await direct.first().click();
    return;
  }
  const more = page.getByRole('button', { name: /More inspector tabs/ });
  await more.click({ timeout: 10000 });
  await page.getByRole('menuitem', { name: label, exact: true }).click({ timeout: 10000 });
}

async function selectMockupSurface(page: Page, surfaceName: string): Promise<void> {
  // Undo/redo preserves the current surface-edit selection. In that state the
  // canvas shows handles and the Done action instead of the surface chips.
  // Keep the existing selection when it is already the requested surface;
  // reopening it through a canvas chip would be both redundant and impossible
  // while the edit toolbar is active.
  const editToolbar = page.getByRole('toolbar', { name: 'Mockup surface actions' });
  if (await editToolbar.isVisible().catch(() => false)) {
    await expect(editToolbar.locator('.mockup-overlay__toolbar-label')).toContainText(surfaceName);
    return;
  }

  const mockupLayer = page
    .locator('.layers-panel [role="treeitem"]', { hasText: /mockup|banner/i })
    .first();
  await mockupLayer.click();
  const surfaceChip = page.locator('.mockup-overlay__chip', { hasText: surfaceName });
  await expect(surfaceChip).toBeVisible({ timeout: 8000 });
  await surfaceChip.click();
}

/**
 * Sample the visible content canvas and count distinct opaque colours in a
 * central band. A flat unfilled frame would be near-constant; a composed
 * mockup (template background, plate, warped source, crease shading) is not.
 */
async function sampleCanvasColorCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!canvas) return -1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    const x0 = Math.floor(canvas.width * 0.3);
    const x1 = Math.floor(canvas.width * 0.7);
    const y0 = Math.floor(canvas.height * 0.3);
    const y1 = Math.floor(canvas.height * 0.7);
    const data = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 16) {
      if (data[i + 3]! < 16) continue;
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    return seen.size;
  });
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('mesh mockup workflow: apply folded fabric, edit a vertex, persist, export', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await navigateToEditor(page);

  // 1. Source frame + apply the fabric template.
  await createFrame(page, 120, 120);
  await openMockupsPanel(page);
  const card = page.locator('.mockups-panel__card', { hasText: 'Fabric Banner' });
  await card.waitFor({ timeout: 8000 });
  await card.getByRole('button', { name: /^Apply/ }).click();
  await page.waitForTimeout(600);

  const section = page.locator('.mockups-section');
  await section.waitFor({ timeout: 8000 });
  await expect(section.getByText('Fabric Banner — Folded')).toBeVisible();

  // The apply path does not move the camera; fit the document so the whole
  // composed mockup (not a zoomed plate corner) fills the sample band.
  await page.getByRole('button', { name: 'Fit all to viewport' }).click();
  await page.waitForTimeout(800);

  // 2. The canvas paints the composed mockup (not a blank frame).
  const colorCount = await sampleCanvasColorCount(page);
  expect(colorCount).toBeGreaterThan(8);
  await page.screenshot({ path: evidencePath(`${evidenceDir}/01-applied.png`) });

  // 3. Select the fabric surface chip, then drag one grid vertex.
  const chip = page.locator('.mockup-overlay__chip', { hasText: 'Banner fabric' });
  await chip.waitFor({ timeout: 8000 });
  await chip.click();
  await page.waitForTimeout(250);

  const handle = page
    .locator('.mockup-overlay__handle[aria-label*="Grid vertex row 1, column 2"]')
    .first();
  await expect(handle).toHaveCount(1);
  await expect(section.getByText('Template default')).toBeVisible();

  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.screenshot({ path: evidencePath(`${evidenceDir}/02-vertex-before.png`) });
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 24,
    handleBox!.y + handleBox!.height / 2 + 30,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path: evidencePath(`${evidenceDir}/03-vertex-after.png`) });

  // The gesture is one transaction: the inspector reflects the edited grid...
  await expect(section.getByText('Reset mesh')).toBeVisible({ timeout: 5000 });

  // ...and a single undo returns to the template default.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  await selectMockupSurface(page, 'Banner fabric');
  await expect(section.getByText('Template default')).toBeVisible({ timeout: 5000 });

  // Redo re-applies the vertex edit so the persistence half has an override.
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(400);
  await selectMockupSurface(page, 'Banner fabric');
  await expect(section.getByText('Reset mesh')).toBeVisible({ timeout: 5000 });
  await expect(section.getByText(/cells/)).toContainText('4 x 2');

  // 4. Save, reopen from Home; the mesh override survives.
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1200);
  await page.goto('/', { timeout: 60000, waitUntil: 'domcontentloaded' });
  const fileRow = page.getByRole('gridcell').first();
  await fileRow.waitFor({ timeout: 20000 });
  await fileRow.dblclick();
  await page.locator('.layers-panel').waitFor({ timeout: 20000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
  await page
    .locator('.layers-panel [role="treeitem"]', { hasText: /mockup|banner/i })
    .first()
    .click();
  await page.waitForTimeout(300);
  const reopenedSection = page.locator('.mockups-section');
  await expect(reopenedSection).toBeVisible({ timeout: 8000 });
  // The mesh fieldset lives in the per-surface editor; select the surface row.
  const surfaceRow = reopenedSection.getByRole('button', { name: /Banner fabric/ });
  await expect(surfaceRow).toBeVisible({ timeout: 5000 });
  await surfaceRow.click();
  await page.waitForTimeout(500);
  await expect(reopenedSection.getByText('Reset mesh')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: evidencePath(`${evidenceDir}/04-inspector-reopened.png`) });

  // 5. Export PNG through the real dialog; decode and inspect.
  await openInspectorTab(page, 'Export');
  await page.getByRole('radio', { name: 'PNG', exact: true }).click();
  await page.getByRole('button', { name: 'Add configuration' }).click();
  await page.evaluate(() => {
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.keyboard.press('Control+e');
  const exportDialog = page.getByRole('dialog', { name: 'Export' });
  const exportButton = exportDialog.getByRole('button', { name: /^Export \(/ });
  await expect(exportButton).toBeVisible();
  await exportButton.click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const bytes = readFileSync(downloadPath as string);
  const dims = pngDimensions(bytes);
  expect(dims).not.toBeNull();
  expect(dims!.width).toBeGreaterThan(0);
  expect(dims!.height).toBeGreaterThan(0);

  const png = PNG.sync.read(bytes);
  const seen = new Set<number>();
  let opaque = 0;
  for (let i = 0; i < png.data.length; i += 64) {
    if (png.data[i + 3]! < 16) continue;
    opaque++;
    seen.add((png.data[i]! << 16) | (png.data[i + 1]! << 8) | png.data[i + 2]!);
  }
  // A composed folded mockup is richly coloured; a bare frame is not.
  expect(opaque).toBeGreaterThan(200);
  expect(seen.size).toBeGreaterThan(12);
  writeFileSync(evidencePath(`${evidenceDir}/05-export.png`), bytes);

  expect(consoleErrors.filter((text) => !text.includes('favicon'))).toEqual([]);
});
