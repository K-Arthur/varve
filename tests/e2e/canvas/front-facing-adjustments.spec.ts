import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

const REVIEW_DIR = path.resolve('reports/ui-review/front-facing-adjustments');
const IMAGE_FIXTURE = path.resolve('tests/e2e/fixtures/test-image.png');

async function createAdjustmentLayer(page: import('@playwright/test').Page) {
  await page.getByRole('menuitem', { name: /^Object$/i }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await expect(page.locator('.adj-panel__header-name')).toHaveText('Adjustment Layer');
}

async function addAdjustment(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: /add adjustment/i }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}$`, 'i') }).click();
  await expect(page.getByText(name, { exact: true }).last()).toBeVisible();
}

test.describe('front-facing adjustment and canvas controls', () => {
  test('exposes hue ranges, channel histograms, curves histogram, and auto controls', async ({
    page,
  }) => {
    test.setTimeout(120000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToEditor(page);

    await page.locator('#file-import-input').setInputFiles(IMAGE_FIXTURE);
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await createAdjustmentLayer(page);

    const autoWhiteBalance = page.getByRole('button', { name: 'Auto White Balance' });
    await expect(autoWhiteBalance).toBeVisible();
    await expect(autoWhiteBalance).toBeEnabled();
    await autoWhiteBalance.click();
    await expect(page.getByText('Color Balance', { exact: true }).last()).toBeVisible();

    await addAdjustment(page, 'Hue / Saturation');
    const range = page.getByRole('combobox', { name: 'Hue/Saturation range' });
    await expect(range).toBeVisible();
    await range.click();
    await page.getByRole('option', { name: 'Reds' }).click();
    await expect(page.getByRole('slider', { name: 'Hue reds' })).toBeVisible();
    await page.getByRole('slider', { name: 'Hue reds' }).press('ArrowRight');
    await page.screenshot({ path: path.join(REVIEW_DIR, '01-hue-saturation.png') });

    await addAdjustment(page, 'Levels');
    const redChannel = page.locator('.histogram-widget__channels label').filter({ hasText: /^R$/ });
    await expect(redChannel).toBeVisible();
    await redChannel.click();
    await expect(redChannel.locator('input')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Auto Contrast' })).toBeVisible();
    await page.getByRole('button', { name: 'Auto Contrast' }).click();
    await page.screenshot({ path: path.join(REVIEW_DIR, '02-levels-red-auto-contrast.png') });

    await addAdjustment(page, 'Curves');
    const curve = page.getByRole('img', { name: /Curve editor/i });
    await expect(curve).toBeVisible();
    await expect(curve.locator('xpath=preceding-sibling::canvas')).toHaveCount(1);
    await page.screenshot({ path: path.join(REVIEW_DIR, '03-curves-histogram.png') });
  });

  test('reaches Pixel Info and the soft-proof/gamut controls from the canvas shell', async ({
    page,
  }) => {
    test.setTimeout(120000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas is not measurable');

    await expect(page.locator('[data-tool="pixelProbe"]')).toBeVisible();
    await page.locator('[data-tool="pixelProbe"]').click();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('pixel-probe-overlay')).toBeVisible();
    await expect(page.getByTestId('pixel-probe-overlay')).toContainText('Pixel Info');
    await page.screenshot({ path: path.join(REVIEW_DIR, '04-pixel-info.png') });

    const softProof = page.getByText('Soft Proof', { exact: true });
    await expect(softProof).toBeVisible();
    await softProof.click();
    await expect(page.getByRole('checkbox', { name: /Soft proof disabled/i })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Show out-of-gamut colors' })).toBeVisible();
    await page.getByRole('checkbox', { name: /Soft proof disabled/i }).check();
    await page.getByRole('checkbox', { name: 'Show out-of-gamut colors' }).check();
    await page.screenshot({ path: path.join(REVIEW_DIR, '05-soft-proof-gamut.png') });
  });

  test('shows and moves a spatial filter control on the canvas', async ({ page }) => {
    test.setTimeout(120000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToEditor(page);

    await page.keyboard.press('r');
    await dragOnCanvas(page, 180, 160, 460, 380);
    await createAdjustmentLayer(page);
    await addAdjustment(page, 'RGB Split');

    const mode = page.getByRole('combobox', { name: 'RGB split mode' });
    await mode.click();
    await page.getByRole('option', { name: 'Radial (lens fringe)' }).click();
    const control = page.getByTestId('spatial-filter-control');
    await expect(control).toBeVisible();
    const before = await control.boundingBox();
    if (!before) throw new Error('spatial filter control is not measurable');
    await control.dragTo(page.locator('canvas.editor-canvas__content-layer'), {
      targetPosition: { x: 360, y: 260 },
    });
    const after = await control.boundingBox();
    if (!after) throw new Error('spatial filter control disappeared after drag');
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(1);
    await page.screenshot({ path: path.join(REVIEW_DIR, '06-spatial-filter-control.png') });
  });

  test('reorders object filters with drag while keeping keyboard chevrons available', async ({
    page,
  }) => {
    test.setTimeout(120000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToEditor(page);

    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 140, 430, 340);
    await page.getByRole('tab', { name: 'Appearance' }).click();
    const objectFiltersDisclosure = page.getByRole('button', {
      name: 'Object Filters',
      exact: true,
    });
    if ((await objectFiltersDisclosure.getAttribute('aria-expanded')) !== 'true') {
      await objectFiltersDisclosure.click();
    }

    const addFilter = page.getByRole('combobox', { name: 'Add Object Filter' });
    await addFilter.click();
    await page.getByRole('option', { name: 'Brightness', exact: true }).click();
    await addFilter.click();
    await page.getByRole('option', { name: 'Contrast', exact: true }).click();
    const rows = page.locator('ul[aria-label="Object Filter stack"] > li.smart-filters__row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Brightness');
    await expect(rows.nth(1)).toContainText('Contrast');
    await expect(page.getByRole('button', { name: 'Move Contrast up' })).toBeVisible();

    await rows.nth(1).dragTo(rows.nth(0));
    await expect(rows.nth(0)).toContainText('Contrast');
    await expect(rows.nth(1)).toContainText('Brightness');
    const moveBrightnessUp = page.getByRole('button', { name: 'Move Brightness up' });
    await moveBrightnessUp.focus();
    await page.keyboard.press('Enter');
    await expect(rows.nth(0)).toContainText('Brightness');
    await expect(rows.nth(1)).toContainText('Contrast');
    await page.screenshot({ path: path.join(REVIEW_DIR, '07-filter-stack-reordered.png') });
  });
});
