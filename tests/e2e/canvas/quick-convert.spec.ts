import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/', { timeout: 120000, waitUntil: 'domcontentloaded' });
  const continueNormal = page.getByRole('button', { name: /Continue normal startup/i });
  if (await continueNormal.isVisible({ timeout: 1000 }).catch(() => false)) {
    await continueNormal.click();
  }
  for (let i = 0; i < 6; i += 1) {
    const open = page.locator('dialog[open]');
    if ((await open.count()) === 0) break;
    await open
      .last()
      .evaluate((dialog) => (dialog as HTMLDialogElement).close())
      .catch(() => {});
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: /^new$/i }).click({ timeout: 30000 });
  const createDesign = page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i });
  await createDesign.waitFor({ timeout: 20000 });
  await createDesign.click({ force: true, timeout: 20000 });
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach((dialog) => {
      (dialog as HTMLDialogElement).close();
    });
  });
  await page.keyboard.press('Escape');
}

test('opens Quick Convert, discloses the conversion contract, and saves a real output', async ({
  page,
}) => {
  await navigateToEditor(page);
  await openMenu(page, 'File');
  await expect(page.getByRole('menuitem', { name: 'Quick Convert…', exact: true })).toBeVisible();

  await page.getByRole('menuitem', { name: 'Quick Convert…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick Convert' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/browser or desktop runtime codecs/i)).toBeVisible();
  await expect(dialog.getByText(/one normalized raster frame/i)).toBeVisible();

  const screenshotPath = path.join('/tmp', 'varve-quick-convert-dialog.png');
  await dialog.screenshot({ path: screenshotPath, animations: 'disabled' });

  const pngPath = path.join('/tmp', `varve-quick-convert-${Date.now()}.png`);
  const pngDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 16;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#173f46';
    context.fillRect(0, 0, 24, 16);
    context.fillStyle = '#efc45a';
    context.fillRect(5, 3, 14, 10);
    return canvas.toDataURL('image/png');
  });
  fs.writeFileSync(pngPath, Buffer.from(pngDataUrl.split(',')[1]!, 'base64'));

  await dialog.locator('input[type="file"]').setInputFiles(pngPath);
  await expect(dialog.getByText(/24 x 16|PNG ·/i)).toBeVisible({ timeout: 10000 });
  await expect(dialog.getByText(/embedded ICC|metadata are not copied/i)).toBeVisible();
  await expect(dialog.getByText('Ready', { exact: true })).toBeVisible();

  // Exercise the browser download fallback deterministically. Chromium may
  // expose the File System Access picker in headed mode, which would require
  // an interactive native dialog rather than emit a Playwright download.
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await dialog.getByRole('button', { name: 'Convert and save' }).click();
  const savedFile = await downloadPromise;
  expect(savedFile.suggestedFilename()).toMatch(/\.webp$/i);
  await expect(dialog.getByText(/Saved .*\.webp/i)).toBeVisible({ timeout: 20000 });

  await dialog.screenshot({ path: '/tmp/varve-quick-convert-saved.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
  fs.unlinkSync(pngPath);
});
