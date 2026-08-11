import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

async function switchTo(page: import('@playwright/test').Page, label: string) {
  const tab = page.locator(`.workspace-tabs__tab[aria-label="${label} workspace"]`);
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    return;
  }
  // Narrow strip: the mode lives in the overflow menu.
  const more = page.getByRole('button', { name: 'More workspaces' });
  await more.click();
  await page
    .getByRole('menu', { name: 'More workspaces' })
    .getByRole('menuitem', { name: label })
    .click();
}

test.describe('Cross-mode workflow — safe switching preserves document state', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('selection, zoom, and undo history survive a full round-trip through all four modes', async ({
    page,
  }) => {
    // The first-launch "Getting started" checklist can be open and intercept
    // pointer events; dismiss it before drawing.
    const dismissChecklist = page.getByRole('button', { name: 'Dismiss' });
    if (await dismissChecklist.isVisible({ timeout: 1000 }).catch(() => false)) {
      await dismissChecklist.click();
    }

    // Draw a rectangle and select it (rect tool auto-selects on creation).
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 250);
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.up();
    await page.keyboard.press('v'); // select tool, keeps the new shape selected

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    const selectionLabel = page.locator('.editor-status').getByText('Rectangle 1', { exact: true });
    await expect(selectionLabel).toBeVisible();

    // Set a distinctive zoom level (viewport state) before switching modes.
    const zoomInput = page.locator('#menubar-zoom');
    await zoomInput.fill('250');
    await zoomInput.press('Enter');
    await expect(zoomInput).toHaveValue('250');

    // Round-trip through Print -> Draw -> Photo -> back to Design.
    for (const mode of ['Print', 'Draw', 'Photo', 'Design']) {
      await switchTo(page, mode);
      await expect(
        page.locator(`.workspace-tabs__tab[aria-label="${mode} workspace"]`),
      ).toHaveAttribute('aria-checked', 'true');

      // Document survives: the shape is still the only layer.
      await expect(page.getByRole('treeitem')).toHaveCount(1);
      // Viewport survives: zoom is untouched by mode switching.
      await expect(zoomInput).toHaveValue('250');
    }

    // Selection survived the whole round-trip (Design mode again by now).
    await expect(selectionLabel).toBeVisible();

    // History survived: undo (from Design mode, after 4 mode switches) still
    // removes the shape created before any mode switch happened.
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem')).toHaveCount(0);
  });
});
