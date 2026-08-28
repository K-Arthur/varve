/**
 * Real-browser regression coverage for the pixel-selection flow.
 *
 * This spec intentionally uses the public file-import and menu surfaces: the
 * tools depend on actual PointerEvents, browser image decoding, and canvas
 * placement. Unit tests cannot exercise those seams.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function importAndSelectImage(page: import('@playwright/test').Page) {
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

  await page.keyboard.press('v');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not available');

  // The public importer centres this fixture in the current viewport. Use the
  // actual canvas geometry rather than a hard-coded document offset: panel
  // widths and the initial zoom legitimately change between workspaces.
  // Selecting through the canvas is important: the floating transform
  // requires both an AreaSelection and an explicit image target.
  // The fixture's centre is a transparent junction between its colour blocks;
  // choose a known opaque pixel in the blue quadrant instead.
  const point = { x: box.x + box.width / 2 - 25, y: box.y + box.height / 2 - 25 };
  await page.mouse.click(point.x, point.y);
  return point;
}

async function openPixelSelectionCommand(
  page: import('@playwright/test').Page,
  command: RegExp,
): Promise<void> {
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const pixelSelection = page.getByRole('menuitem', { name: 'Pixel Selection' });
  await expect(pixelSelection).toBeVisible();
  // The in-window menubar opens nested menus on pointer entry (matching its
  // desktop-menu behaviour); clicking an already-hovered item closes it.
  await pixelSelection.hover();
  const submenu = page.getByRole('menu', { name: 'Pixel Selection' });
  await expect(submenu).toBeVisible();
  await submenu.getByRole('menuitem', { name: command }).click();
}

test.describe('pixel selection transform', () => {
  test('Magic Wand creates an image area selection and Transform Pixels commits a real drag', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    const point = await importAndSelectImage(page);

    await page.keyboard.press('Shift+W');
    const wandOptions = page.getByTestId('magicwand-options');
    await expect(wandOptions).toBeVisible({ timeout: 5000 });
    await expect(wandOptions.getByLabel('Colour tolerance')).toBeVisible();
    await page.mouse.click(point.x, point.y);

    const announcer = page.locator('#strata-canvas-announcer-polite');
    await expect(announcer).toContainText(/Magic Wand selection created/, { timeout: 10000 });

    await openPixelSelectionCommand(page, /^Transform Pixels$/);
    await expect(announcer).toContainText(/Transforming selected pixels/, { timeout: 10000 });

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 24, point.y + 12, { steps: 3 });
    await page.mouse.up();
    await expect(announcer).toContainText(/Pixel transform applied/, { timeout: 15000 });
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test('Escape abandons the temporary floating buffer without committing it', async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    const point = await importAndSelectImage(page);

    await page.keyboard.press('Shift+W');
    await page.mouse.click(point.x, point.y);
    const announcer = page.locator('#strata-canvas-announcer-polite');
    await expect(announcer).toContainText(/Magic Wand selection created/, { timeout: 10000 });
    await openPixelSelectionCommand(page, /^Transform Pixels$/);
    await expect(announcer).toContainText(/Transforming selected pixels/, { timeout: 10000 });

    // Return keyboard ownership to the real canvas. The command menu is
    // portaled and unmounts after activation.
    await page.locator('canvas.editor-canvas__content-layer').focus();
    await page.keyboard.press('Escape');
    await expect(announcer).toContainText(/Pixel transform cancelled/, { timeout: 5000 });
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });
});
