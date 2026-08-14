import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

test.describe('Workspace Mode Switching — Functional Assertions', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('design mode is default with all panels', async ({ page }) => {
    const designBtn = page.locator('.workspace-tabs__tab[aria-label="Design workspace"]');
    await expect(designBtn).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-panel="layers"]')).toBeVisible();
    await expect(page.locator('[data-panel="inspector"]')).toBeVisible();
    // Page nav is workspace- and page-count-dependent: the design workspace
    // keeps it hidden for single-page documents (it appears on multi-page
    // docs and in the Print workspace).
    await expect(page.locator('.page-nav-container')).not.toBeVisible();
    await expect(page.locator('[data-testid="toolbar"]')).toBeVisible();
    await expect(page.locator('.editor-status')).toBeVisible();
  });

  test('print mode via toolbar button', async ({ page }) => {
    await page.locator('.workspace-tabs__tab[aria-label="Print workspace"]').click();
    await expect(
      page.locator('.workspace-tabs__tab[aria-label="Print workspace"]'),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-panel="layers"]')).toBeVisible();
    await expect(page.locator('[data-panel="inspector"]')).toBeVisible();
    // Fresh design files start page-less (startMode 'empty'); the page nav
    // appears once the document has pages.
    await expect(page.locator('.page-nav-container')).not.toBeVisible();
    await expect(page.locator('[data-testid="toolbar"]')).toBeVisible();
  });

  test('drawing mode hides page nav and shows brush controls', async ({ page }) => {
    await page.locator('.workspace-tabs__tab[aria-label="Draw workspace"]').click();
    await expect(page.locator('.workspace-tabs__tab[aria-label="Draw workspace"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('.page-nav-container')).not.toBeVisible();
    await expect(page.locator('.floating-toolbar__drawing')).toBeVisible();
    await expect(page.locator('.floating-toolbar__colors')).toBeVisible();
  });

  test('print mode hides paint/retouch tools', async ({ page }) => {
    await page.locator('.workspace-tabs__tab[aria-label="Print workspace"]').click();
    await expect(page.locator('[data-tool="paint"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="eraser"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="cloneStamp"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="rect"]')).toBeVisible();
    await expect(page.locator('[data-tool="select"]')).toBeVisible();
  });

  test('mode switch round-trip preserves layers', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.up();
    await page.keyboard.press('v');

    await page.locator('.workspace-tabs__tab[aria-label="Print workspace"]').click();
    await expect(page.getByRole('treeitem').first()).toBeVisible();
    await page.locator('.workspace-tabs__tab[aria-label="Draw workspace"]').click();
    await expect(page.getByRole('treeitem').first()).toBeVisible();
    await page.locator('.workspace-tabs__tab[aria-label="Design workspace"]').click();
    await expect(page.getByRole('treeitem').first()).toBeVisible();
  });

  test('workspace entries in View menu', async ({ page }) => {
    await page.getByRole('menuitem', { name: 'View' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Workspace: Design' })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: 'Workspace: Print' })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: 'Workspace: Draw' })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: 'Workspace: Photo' })).toBeVisible();
  });

  test('mode switch preserves zoom', async ({ page }) => {
    const zoomInput = page.locator('#menubar-zoom');
    await zoomInput.fill('200');
    await zoomInput.press('Enter');
    await expect(zoomInput).toHaveValue('200');
    await page.locator('.workspace-tabs__tab[aria-label="Print workspace"]').click();
    await expect(zoomInput).toHaveValue('200');
  });

  test('ARIA radiogroup and radio roles', async ({ page }) => {
    await expect(page.locator('[role="radiogroup"][aria-label="Workspace"]')).toBeVisible();
    const radios = page.locator('.workspace-tabs__tab[role="radio"]');
    await expect(radios).toHaveCount(4);
    await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'false');
    await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'false');
    await expect(radios.nth(3)).toHaveAttribute('aria-checked', 'false');
  });

  test('workspace switcher sits with the utility controls, not the document title', async ({
    page,
  }) => {
    // Grouped with undo/redo/zoom at the trailing edge of the menubar, not
    // crowding the centered document-name field.
    const switcher = page.locator('.editor-menubar__controls .workspace-tabs');
    await expect(switcher).toBeVisible();
    await expect(page.locator('.editor-menubar__center .workspace-tabs')).toHaveCount(0);
    // Icon + label per mode.
    const radios = switcher.locator('[role="radio"]');
    await expect(radios.first().locator('svg')).toBeVisible();
    await expect(radios.first()).toHaveAttribute('aria-label', 'Design workspace');
  });

  test('narrow window does not break layout', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500);
    await expect(page.locator('.workspace-tabs')).toBeVisible();
    await expect(page.locator('[data-testid="toolbar"]')).toBeVisible();
    await expect(page.locator('.editor-status')).toBeVisible();

    const status = await page.locator('.editor-status').boundingBox();
    expect(status).toBeTruthy();
    for (const fab of await page.locator('.editor__fab').all()) {
      const box = await fab.boundingBox();
      expect(box).toBeTruthy();
      if (status && box) {
        expect(
          box.y + box.height,
          'responsive panel control must not cover the status bar',
        ).toBeLessThanOrEqual(status.y);
      }
    }
  });

  test('status bar stays below canvas', async ({ page }) => {
    const status = await page.locator('.editor-status').boundingBox();
    const canvas = await page.locator('.editor-canvas').boundingBox();
    expect(status).toBeTruthy();
    expect(canvas).toBeTruthy();
    if (status && canvas) {
      expect(status.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 10);
    }
  });
});
