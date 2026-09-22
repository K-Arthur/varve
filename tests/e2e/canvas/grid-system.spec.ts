import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Grid system — real editor controls and visual overlay', () => {
  test('keeps document, pixel, and layout-guide visibility independent', async ({ page }) => {
    await navigateToEditor(page);

    const documentGrid = page.getByRole('button', { name: 'Document Grid', exact: true });
    await documentGrid.scrollIntoViewIfNeeded();
    await documentGrid.click();

    const showGrid = page.getByRole('switch', { name: 'Show grid', exact: true });
    const snapGrid = page.getByRole('switch', { name: 'Snap to document grid', exact: true });
    const showPixelGrid = page.getByRole('switch', {
      name: 'Show at high zoom',
      exact: true,
    });
    const snapPixels = page.getByRole('switch', { name: 'Snap to integer pixels', exact: true });
    const showLayoutGuides = page.getByRole('switch', {
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
    // Keep the drag clear of the empty-canvas onboarding card, which can
    // otherwise consume the pointer sequence before the first frame exists.
    await dragOnCanvas(page, 24, 24, 248, 168);
    await page.keyboard.press('v');
    await page.waitForTimeout(300);

    const layoutGuides = page.getByRole('button', { name: 'Layout guides', exact: true });
    await layoutGuides.scrollIntoViewIfNeeded();
    await layoutGuides.click();
    await page.getByRole('button', { name: 'Add layout guide', exact: true }).click();
    await expect(page.locator('.insp-layout-guide-card')).toHaveCount(1);
    await expect(page.getByRole('switch', { name: /show layout guide 1/i })).toBeChecked();

    await page.screenshot({ path: 'test-results/grid-system-editor.png', fullPage: false });
  });

  test('opens Guide Layouts with preview validation and Escape cancel', async ({ page }) => {
    await navigateToEditor(page);
    await page.getByRole('menuitem', { name: 'View', exact: true }).click();
    const viewMenu = page.getByRole('menu', { name: 'View' });
    await expect(viewMenu).toBeVisible();
    await viewMenu.getByRole('menuitem', { name: 'Guides', exact: true }).hover();
    await page.getByRole('menuitem', { name: /Guide Layouts/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Guide Layouts' });
    await expect(dialog).toBeVisible();
    const count = dialog.locator('input').first();
    await count.fill('not-a-number');
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.keyboard.press('Control+Alt+Shift+g');
    await expect(page.getByRole('dialog', { name: 'Guide Layouts' })).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
