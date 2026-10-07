import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor, navigateToHome } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });

async function selectionGeometry(page: Page) {
  const rect = page.locator('svg:has(filter#selection-glow) > rect').first();
  await expect(rect).toBeVisible();
  return rect.evaluate((element) => {
    const selection = element as SVGRectElement;
    return {
      x: selection.x.baseVal.value,
      y: selection.y.baseVal.value,
      width: selection.width.baseVal.value,
      height: selection.height.baseVal.value,
    };
  });
}

test('active-surface fit centers actual Design Canvas artwork without a publishing page', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  await expect(page.getByRole('button', { name: 'Fit active canvas', exact: true })).toBeDisabled();
  await page.keyboard.press('r');
  await dragOnCanvas(page, 80, 60, 220, 160);
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Fit active canvas', exact: true })).toBeEnabled();
  const zoom = page.locator('#status-zoom');
  await zoom.fill('25');
  await zoom.press('Enter');
  await expect(zoom).toHaveValue('25');

  // Accept the old name while driving the regression: a changed label alone
  // must not count as fixing a no-op camera action.
  await page.getByRole('button', { name: /^Fit active (page|canvas)$/ }).click();
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(25);
  const canvas = page.getByTestId('editor-canvas');
  const box = (await canvas.boundingBox())!;
  const toolbar = (await page.locator('.floating-toolbar[data-testid="toolbar"]').boundingBox())!;
  const clearHeight = toolbar.y - box.y - 8;
  await expect
    .poll(async () => {
      const shape = await selectionGeometry(page);
      return {
        x: shape.x + shape.width / 2,
        y: shape.y + shape.height / 2,
        inside:
          shape.x >= 39 &&
          shape.y >= 39 &&
          shape.x + shape.width <= box.width - 39 &&
          shape.y + shape.height <= clearHeight - 39,
      };
    })
    .toEqual({
      x: expect.closeTo(box.width / 2, 0),
      y: expect.closeTo(clearHeight / 2, 0),
      inside: true,
    });
  await page.screenshot({ path: testInfo.outputPath('fit-design-canvas.png') });
});

test('Fit page frames the publishing trim even when the page has no artwork', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  await page.getByRole('radio', { name: 'Print workspace', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Publishing pages' })).toBeVisible();
  await page.getByRole('button', { name: 'Add publishing page', exact: true }).click();
  await page.locator('#status-zoom').fill('200');
  await page.locator('#status-zoom').press('Enter');
  await page.getByRole('button', { name: 'Fit active page', exact: true }).click();
  const dimensions = await page.getByTestId('editor-canvas').evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  const expectedZoom = Math.min((dimensions.width - 80) / 1920, (dimensions.height - 80) / 1080);
  await expect(page.locator('#status-zoom')).toHaveValue(
    String(Math.round(expectedZoom * 10000) / 100),
  );
  await page.screenshot({ path: testInfo.outputPath('fit-publishing-page.png') });
});

test('portrait publishing trim stays clear of the floating toolbar after fitting', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  await page.getByRole('radio', { name: 'Print workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Add publishing page', exact: true }).click();
  await page.getByTestId('editor-canvas').focus();
  await page.keyboard.press('q');
  await page
    .locator('.page-print')
    .getByRole('button', { name: 'Swap orientation', exact: true })
    .click();
  await page.getByRole('button', { name: 'Fit active page', exact: true }).click();
  const trim = page.locator('.page-tool-overlay > div').first();
  await expect(trim).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('fit-portrait-page.png') });
  await expect
    .poll(async () => {
      const pageBox = (await trim.boundingBox())!;
      const toolbar = (await page
        .locator('.floating-toolbar[data-testid="toolbar"]')
        .boundingBox())!;
      return pageBox.y + pageBox.height - toolbar.y + 8;
    })
    .toBeLessThanOrEqual(0);
});

test('page-only documents retain paper fitting in Photo', async ({ page }, testInfo) => {
  await navigateToHome(page);
  await page.getByTestId('new-file-button').click();
  const newDialog = page.locator('dialog.varve-dialog[open]');
  await newDialog.getByRole('button', { name: /advanced settings/i }).click();
  await newDialog
    .getByRole('radiogroup', { name: 'Document intent' })
    .locator('label')
    .filter({ hasText: /^Print$/ })
    .click();
  await newDialog.getByTestId('create-design-button').click();
  await expect(page.locator('.editor-shell')).toBeVisible();
  await page.getByRole('radio', { name: 'Photo workspace', exact: true }).click();
  const fit = page.getByRole('button', { name: 'Fit active page', exact: true });
  await expect(fit).toBeEnabled();
  await page.locator('#status-zoom').fill('200');
  await page.locator('#status-zoom').press('Enter');
  await fit.click();
  await expect
    .poll(async () => Number(await page.locator('#status-zoom').inputValue()))
    .toBeLessThan(200);
  await page.screenshot({ path: testInfo.outputPath('fit-page-only-photo.png') });
});
