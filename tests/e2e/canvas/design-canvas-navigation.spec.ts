import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Design Canvas navigation is deliberately separate from Publishing Pages:
 * canvases are document-level exploratory surfaces, while pages are exposed
 * by the Print workspace for trim, order, and export.
 */
test.describe('Design Canvas navigator', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
  });

  test('exposes canvases above a layer tree that contains artwork only', async ({ page }) => {
    const navigator = page.getByRole('region', { name: 'Design Canvases' });
    await expect(navigator).toBeVisible();
    await expect(navigator.getByRole('heading', { name: /Design Canvases/ })).toBeVisible();
    await expect(navigator.getByRole('button', { name: 'Add Design Canvas' })).toBeVisible();
    const firstCanvas = navigator.locator('button.design-canvas-panel__select').filter({
      hasText: 'Canvas 1',
    });
    await expect(firstCanvas).toHaveAttribute('aria-current', 'true');

    const layers = page.getByRole('tree', { name: 'Layers' });
    await expect(layers.locator('[data-node-id]')).toHaveCount(0);
    await expect(layers.getByText('No layers yet')).toBeVisible();
  });

  test('creates, switches, and renames a Design Canvas', async ({ page }) => {
    const navigator = page.getByRole('region', { name: 'Design Canvases' });
    await navigator.getByRole('button', { name: 'Add Design Canvas' }).click();

    const secondCanvas = navigator
      .locator('button.design-canvas-panel__select')
      .filter({ hasText: 'Canvas 2' });
    await expect(secondCanvas).toBeVisible();
    await secondCanvas.click();
    await expect(secondCanvas).toHaveAttribute('aria-current', 'true');

    await navigator.getByRole('button', { name: 'Rename Canvas 2' }).click();
    const renameInput = page.getByRole('textbox', { name: 'Rename Design Canvas' });
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Campaign exploration');
    await renameInput.press('Enter');

    await expect(
      navigator
        .locator('button.design-canvas-panel__select')
        .filter({ hasText: 'Campaign exploration' }),
    ).toHaveAttribute('aria-current', 'true');
  });

  test('keeps the Design Canvas navigator visually distinct from layers', async ({ page }) => {
    await expect(page.getByRole('region', { name: 'Design Canvases' })).toHaveScreenshot(
      'design-canvas-navigator.png',
    );
  });
});
