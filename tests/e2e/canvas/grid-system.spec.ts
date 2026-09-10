import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Grid system — real editor controls and visual overlay', () => {
  test('keeps document, pixel, and layout-guide visibility independent', async ({ page }) => {
    await navigateToEditor(page);

    const documentGrid = page.getByRole('button', { name: 'Document Grid', exact: true });
    await documentGrid.scrollIntoViewIfNeeded();
    await documentGrid.click();

    const showGrid = page.getByRole('checkbox', { name: 'Show grid', exact: true });
    const snapGrid = page.getByRole('checkbox', { name: 'Snap to document grid', exact: true });
    const showPixelGrid = page.getByRole('checkbox', {
      name: 'Show pixel grid at high zoom',
      exact: true,
    });
    const snapPixels = page.getByRole('checkbox', { name: 'Snap to integer pixels', exact: true });
    const showLayoutGuides = page.getByRole('checkbox', {
      name: 'Show layout guides',
      exact: true,
    });

    await expect(showGrid).toBeVisible();
    await expect(snapGrid).toBeVisible();
    await expect(showPixelGrid).toBeVisible();
    await expect(snapPixels).toBeVisible();
    await expect(showLayoutGuides).toBeVisible();

    await showGrid.check();
    await snapGrid.uncheck();
    await showPixelGrid.check();
    await snapPixels.check();
    await showLayoutGuides.check();
    await expect(showGrid).toBeChecked();
    await expect(snapGrid).not.toBeChecked();
    await expect(showPixelGrid).toBeChecked();
    await expect(snapPixels).toBeChecked();
    await expect(showLayoutGuides).toBeChecked();

    await page.keyboard.press('f');
    await dragOnCanvas(page, 180, 140, 620, 500);
    await page.keyboard.press('v');
    await page.waitForTimeout(300);

    const layoutGuides = page.getByRole('button', { name: 'Layout guides', exact: true });
    await layoutGuides.scrollIntoViewIfNeeded();
    await layoutGuides.click();
    await page.getByRole('button', { name: 'Add layout guide', exact: true }).click();
    await expect(page.locator('.insp-layout-guide-card')).toHaveCount(1);
    await expect(page.getByRole('checkbox', { name: /show layout guide 1/i })).toBeChecked();

    await page.screenshot({ path: 'test-results/grid-system-editor.png', fullPage: false });
  });
});
