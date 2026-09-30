import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
type PngPixels = { width: number; height: number; data: Buffer };
const { PNG } = requireFromEngine('pngjs') as {
  PNG: {
    new (options: { width: number; height: number }): PngPixels;
    sync: {
      write(input: PngPixels): Buffer;
      read(input: Buffer): PngPixels;
    };
  };
};

const VIEWPORT = { width: 1280, height: 800 };

const REFERENCE_FIXTURE = join(process.cwd(), 'tests/e2e/fixtures/real-life-beech-forest.jpg');

async function contentHash(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('content canvas context unavailable');
    return crypto.subtle
      .digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data)
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      );
  });
}

async function coloredPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('content canvas context unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      if (
        (pixels[offset + 3] ?? 0) > 200 &&
        Math.max(red, green, blue) - Math.min(red, green, blue) > 32
      ) {
        count += 1;
      }
    }
    return count;
  });
}

function countReferenceColor(bytes: Buffer): number {
  const png = PNG.sync.read(bytes);
  let count = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const red = png.data[offset] ?? 0;
    const green = png.data[offset + 1] ?? 0;
    const blue = png.data[offset + 2] ?? 0;
    if (
      (png.data[offset + 3] ?? 0) > 200 &&
      Math.max(red, green, blue) - Math.min(red, green, blue) > 32
    ) {
      count += 1;
    }
  }
  return count;
}

async function selectExportTab(page: import('@playwright/test').Page) {
  const tab = page.getByRole('tab', { name: 'Export', exact: true });
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
}

async function referencePoint(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const hook = (
      window as Window & {
        __varveIsoTest?: { worldToScreen: (x: number, y: number) => { x: number; y: number } };
      }
    ).__varveIsoTest;
    const surface = document.querySelector<HTMLElement>('.editor-canvas');
    if (!hook || !surface) throw new Error('canvas projection helper is unavailable');
    const rect = surface.getBoundingClientRect();
    const point = hook.worldToScreen(320, 240);
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
}

test.describe('concept-art reference workflow', () => {
  test.describe.configure({ timeout: 240000 });

  test('keeps a reference visible, gates sampling, and saves the opt-in', async ({
    page,
  }, info) => {
    await page.addInitScript(() => localStorage.setItem('varve.renderWorker', 'off'));
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page, '/?isoTest=1');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.locator('#file-import-input').setInputFiles({
      name: 'beech-forest.jpg',
      mimeType: 'image/jpeg',
      buffer: readFileSync(REFERENCE_FIXTURE),
    });
    const referenceRow = page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'beech-forest.jpg' })
      .first();
    await expect(referenceRow).toBeVisible({ timeout: 30000 });
    await referenceRow.click();
    await page.keyboard.press('Shift+2');

    const referenceSwitch = page.getByRole('switch', { name: 'Use as concept reference' });
    await expect(referenceSwitch).toBeVisible({ timeout: 15000 });
    const beforeMark = await contentHash(page);
    expect(await coloredPixels(page)).toBeGreaterThan(100);
    await referenceSwitch.check();
    await expect(
      page.locator('.concept-reference-options').getByText('beech-forest.jpg', { exact: true }),
    ).toBeVisible();
    const afterMark = await contentHash(page);
    expect(afterMark, 'marking an image as a reference must not hide its canvas pixels').toBe(
      beforeMark,
    );

    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Undo/ })
      .click();
    await expect(referenceSwitch).not.toBeChecked();
    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Redo/ })
      .click();
    await expect(referenceSwitch).toBeChecked();

    const samplingSwitch = page.getByRole('switch', { name: 'Include in artwork sampling' });
    const exportSwitch = page.getByRole('switch', { name: 'Include in artwork exports' });
    await expect(samplingSwitch).not.toBeChecked();
    await expect(exportSwitch).not.toBeChecked();

    await page.keyboard.press('Shift+W');
    await expect(page.getByTestId('magicwand-options')).toBeVisible();
    await page
      .getByRole('radiogroup', { name: 'Sample source' })
      .getByText('Visible artwork', { exact: true })
      .click();
    const point = await referencePoint(page);
    const announcer = page.locator('#strata-canvas-announcer-polite');
    await page.mouse.click(point.x, point.y);
    await expect(announcer).toContainText('No visible artwork is available to sample', {
      timeout: 15000,
    });

    await samplingSwitch.check();
    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Undo/ })
      .click();
    await expect(samplingSwitch).not.toBeChecked();
    await openMenu(page, 'Edit');
    await page
      .locator('[role="menu"][aria-label="Edit"]')
      .getByRole('menuitem', { name: /^Redo/ })
      .click();
    await expect(samplingSwitch).toBeChecked();

    await page.mouse.click(point.x, point.y);
    await expect(announcer).toContainText(/visible-artwork Magic Wand selection created/i, {
      timeout: 20000,
    });
    await expect.poll(() => coloredPixels(page)).toBeGreaterThan(100);
    await page.screenshot({ path: info.outputPath('concept-reference-sampling-enabled.png') });

    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'PNG', exact: true })
      .click();
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    await expect(page.locator('.spec-export__message')).toContainText(
      /Export failed: .*excluded from artwork exports.*Include in artwork exports/,
    );

    await page.getByRole('tab', { name: 'Design', exact: true }).click();
    await exportSwitch.scrollIntoViewIfNeeded();
    await exportSwitch.check();
    await expect(exportSwitch).toBeChecked();
    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'PNG', exact: true })
      .click();
    const exportDownloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const exportDownload = await exportDownloadPromise;
    const referenceExportPath = info.outputPath('concept-reference-included.png');
    await exportDownload.saveAs(referenceExportPath);
    const { readFile } = await import('node:fs/promises');
    const exportedReference = await readFile(referenceExportPath);
    const exportedPng = PNG.sync.read(exportedReference);
    expect(exportedPng.width).toBe(1280);
    expect(exportedPng.height).toBe(853);
    expect(countReferenceColor(exportedReference)).toBeGreaterThan(100);
    await page.getByRole('tab', { name: 'Design', exact: true }).click();
    await exportSwitch.scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((selectedTheme) => {
        document.documentElement.dataset.theme = selectedTheme;
      }, theme);
      await page.screenshot({
        path: info.outputPath(`concept-reference-${theme}.png`),
      });
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: info.outputPath('concept-reference-narrow.png') });
    await page.setViewportSize(VIEWPORT);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await selectExportTab(page);

    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    });
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('gridcell').first().dblclick();
    await canvas.waitFor({ state: 'visible', timeout: 60000 });
    await page
      .locator('[role="treeitem"][data-node-id]')
      .filter({ hasText: 'beech-forest.jpg' })
      .click();
    const reopenedReferenceSwitch = page.getByRole('switch', {
      name: 'Use as concept reference',
    });
    await expect(reopenedReferenceSwitch).toBeChecked();
    await expect(
      page.locator('.concept-reference-options').getByText('beech-forest.jpg', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Include in artwork sampling' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Include in artwork exports' })).toBeChecked();
    await expect.poll(() => coloredPixels(page)).toBeGreaterThan(100);
    await page.screenshot({ path: info.outputPath('concept-reference-reopened.png') });
  });
});
