/**
 * Production mockup subjects and bounded curved-surface workflow.
 *
 * This stays on the existing Resources → Mockups surface. The test checks
 * discoverability for common production subjects, then exercises the real
 * cylindrical mapping controls and export path with an inspected artifact.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

const reviewDir = 'reports/mockup-review-2026-09-13';

async function createSourceArtwork(page: import('@playwright/test').Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 220, box.y + 200);
  await page.keyboard.insertText('LOCAL LABEL');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.waitForTimeout(200);
}

async function openMockupsPanel(page: import('@playwright/test').Page): Promise<void> {
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
  await expect(tab.first()).toHaveAttribute('aria-selected', 'true');
}

async function applyTemplate(
  page: import('@playwright/test').Page,
  templateName: string,
): Promise<void> {
  const card = page.locator('.mockups-panel__card', { hasText: templateName });
  await card.waitFor({ timeout: 8000 });
  await card.getByRole('button', { name: /^Apply/ }).click();
  await page.waitForTimeout(700);
}

async function openInspectorTab(
  page: import('@playwright/test').Page,
  label: string,
): Promise<void> {
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
  await page.getByRole('button', { name: /More inspector tabs/ }).click({ timeout: 10000 });
  await page.getByRole('menuitem', { name: label, exact: true }).click({ timeout: 10000 });
}

async function exportPng(page: import('@playwright/test').Page): Promise<Buffer> {
  await openInspectorTab(page, 'Export');
  await page.getByRole('radio', { name: 'PNG', exact: true }).click();
  await page.getByRole('button', { name: 'Add configuration' }).click();
  await page.evaluate(() => {
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.keyboard.press('Control+e');
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.waitFor({ timeout: 8000 });
  await dialog.getByRole('button', { name: /^Export \(/ }).click({ timeout: 8000 });
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  return readFileSync(downloadPath as string);
}

test('production subjects are discoverable and cylindrical labels export through the real workflow', async ({
  page,
}) => {
  mkdirSync(reviewDir, { recursive: true });
  await navigateToEditor(page);
  await createSourceArtwork(page);
  await openMockupsPanel(page);

  // The production catalog is filterable without adding a workspace or a
  // second asset manager. These subjects cover common mobile, apparel,
  // signage, stationery, and packaging deliverables.
  await page.getByRole('button', { name: 'Apparel', exact: true }).click();
  await expect(page.locator('.mockups-panel__card', { hasText: 'T-Shirt — Front' })).toBeVisible();
  await page.getByRole('button', { name: 'Signage', exact: true }).click();
  await expect(
    page.locator('.mockups-panel__card', { hasText: 'Billboard — Front' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Stationery', exact: true }).click();
  await expect(page.locator('.mockups-panel__card', { hasText: 'Envelope — Front' })).toBeVisible();
  await page.getByRole('button', { name: 'Packaging', exact: true }).click();
  await expect(
    page.locator('.mockups-panel__card', { hasText: 'Product Label — Cylinder' }),
  ).toBeVisible();

  await applyTemplate(page, 'Product Label — Cylinder');
  const section = page.locator('.mockups-section');
  await section.waitFor({ timeout: 8000 });
  await expect(section.getByText('Product Label — Cylinder')).toBeVisible();
  await section.getByRole('button', { name: /Wrap label/ }).click();
  await expect(section.getByText('Cylinder mapping')).toBeVisible();
  await expect(section.getByText('Front-facing orthographic arc only')).toBeVisible();

  const arcInput = section.getByRole('spinbutton', { name: 'Cylinder wrap degrees' });
  await expect(arcInput).toHaveValue('120');
  await arcInput.fill('135');
  await arcInput.press('Enter');
  await expect(arcInput).toHaveValue('135');
  await section.getByRole('button', { name: 'Natural arc bounds' }).click();
  await expect(section.getByRole('button', { name: 'Natural arc bounds' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.screenshot({
    path: `${reviewDir}/cylinder-workflow.png`,
    fullPage: true,
  });

  const bytes = await exportPng(page);
  expect(bytes.length).toBeGreaterThan(1000);
  const png = PNG.sync.read(bytes);
  expect(png.width).toBeGreaterThan(200);
  expect(png.height).toBeGreaterThan(200);
  let nonTransparentPixels = 0;
  for (let index = 3; index < png.data.length; index += 4) {
    if (png.data[index]! > 0) nonTransparentPixels++;
  }
  expect(nonTransparentPixels).toBeGreaterThan(1000);
  const exportPath = `${reviewDir}/cylinder-export.png`;
  // Keep a reviewable copy in the evidence directory; the download itself is
  // temporary and is not document content.
  writeFileSync(exportPath, bytes);
});
