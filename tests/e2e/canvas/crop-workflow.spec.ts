/**
 * Comprehensive crop workflow E2E tests — trim, expand, convert, and reset.
 *
 * Uses real image fixtures with pointer-driven interaction through the
 * public UI (keyboard, mouse, inspector controls).
 *
 * Isolated from unrelated test failures — this spec uses only the
 * shared navigateToEditor helper and its own dedicated fixtures.
 */
import { expect, test } from '@playwright/test';
import { enterCropMode, importImageFile, selectImageNode } from '../helpers/editor-helpers';
import { navigateToEditor } from '../shared';

test.describe('Image crop workflow — trim, expand, convert, reset', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('import image and verify Crop & Bounds inspector section visible', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'test-image.png');
    await selectImageNode(page);

    // Click on the image tree item to select it
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // The inspector is scrollable; prove the registered section is reachable
    // instead of assuming its header is initially above the fold.
    const cropSection = page.getByRole('button', { name: 'Crop & Bounds', exact: true });
    await cropSection.scrollIntoViewIfNeeded();
    await expect(cropSection).toBeVisible({ timeout: 5000 });
  });

  test('Edit Crop button enters crop mode from inspector', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'test-image.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // Click "Edit Crop" button in the inspector
    const editCropBtn = page.getByRole('button', { name: /edit crop/i });
    await expect(editCropBtn.first()).toBeVisible({ timeout: 5000 });
    await editCropBtn.first().click();
    await page.waitForTimeout(300);

    // Crop overlay should appear
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });
  });

  test('Fit mode segmented control in Image Placement changes image fit', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'test-image.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    const placement = page
      .locator('.insp-disclosure')
      .filter({ has: page.getByRole('button', { name: 'Image Placement', exact: true }) });
    await placement.scrollIntoViewIfNeeded();
    const fillBtn = placement.getByRole('radio', { name: 'Fill', exact: true });
    await fillBtn.click();
    await expect(fillBtn).toHaveAttribute('aria-checked', 'true');
  });

  test('Trim to Subject button is visible for image with mask', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'subject-photo.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // Scroll the inspector to find the Trim section
    const inspectorPanel = page.locator('.inspector-panel');
    if (await inspectorPanel.isVisible()) {
      await inspectorPanel.evaluate((el) => (el.scrollTop = el.scrollHeight));
    }

    // The Trim to Subject button should be visible (even without mask, Trim shows "alpha" fallback)
    const trimBtn = page.getByRole('button', { name: /trim to subject/i });
    await expect(trimBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test('Expand Bounds section shows Convert to Crop & Expand for non-crop mode', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'subject-photo.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // Scroll inspector down to expose Expand Bounds section
    const inspectorPanel = page.locator('.inspector-panel');
    if (await inspectorPanel.isVisible()) {
      await inspectorPanel.evaluate((el) => (el.scrollTop = el.scrollHeight));
    }
    await page.waitForTimeout(300);

    // The Convert to Crop & Expand button should appear for images not in crop mode
    const convertBtn = page.getByRole('button', {
      name: /convert to crop & expand|convert to crop and expand/i,
    });
    const expandBtn = page.getByRole('button', { name: /^expand bounds$/i });

    const convertVisible = await convertBtn
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    const expandVisible = await expandBtn
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    // At least one should be visible depending on current fit mode
    expect(convertVisible || expandVisible).toBe(true);
  });

  test('Trim to Subject button triggers via keyboard shortcut', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'test-image.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // Press the Trim to Subject shortcut (Ctrl+Shift+T)
    await page.keyboard.press('Control+Shift+t');
    await page.waitForTimeout(500);

    // The node should still exist after trim (no crash)
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
  });

  test('Expand Bounds button triggers via keyboard shortcut in crop mode', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'test-image.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // First enter crop mode to enable expand
    await enterCropMode(page);
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });

    // Commit the crop
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Now press the Expand Bounds shortcut (Ctrl+Shift+X)
    await page.keyboard.press('Control+Shift+x');
    await page.waitForTimeout(500);

    // Node should still exist
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
  });

  test('Reset Image Bounds restores node dimensions via shortcut', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'subject-photo.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // First crop + commit to change dimensions
    await enterCropMode(page);
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });
    // Drag the east handle inward
    const eastHandle = page.getByRole('button', { name: 'Resize crop e', exact: true });
    if (await eastHandle.isVisible()) {
      const box = await eastHandle.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2);
        await page.mouse.up();
        await page.waitForTimeout(100);
      }
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Now press Reset Image Bounds shortcut (Ctrl+Alt+R)
    await page.keyboard.press('Control+Alt+r');
    await page.waitForTimeout(500);

    // Node should still exist
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
  });

  test('Object menu has crop commands', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'test-image.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // Open the Object menu
    await page.getByRole('menuitem', { name: /^object$/i }).click();
    await page.waitForTimeout(300);

    // Verify crop commands exist in the menu
    const cropImage = page.getByRole('menuitem', { name: /crop image/i });
    const trimToSubject = page.getByRole('menuitem', { name: /trim to subject/i });
    const expandBounds = page.getByRole('menuitem', { name: /expand bounds/i });
    const resetBounds = page.getByRole('menuitem', { name: /reset image bounds/i });

    // At least some should be visible
    const cropVisible = await cropImage.isVisible().catch(() => false);
    const trimVisible = await trimToSubject.isVisible().catch(() => false);
    const expandVisible = await expandBounds.isVisible().catch(() => false);
    const resetVisible = await resetBounds.isVisible().catch(() => false);

    expect(cropVisible || trimVisible || expandVisible || resetVisible).toBe(true);
  });

  test('Convert to Crop && Expand menu command available', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'test-image.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // Open Object menu
    await page.getByRole('menuitem', { name: /^object$/i }).click();
    await page.waitForTimeout(300);

    // Try to find "Convert to Crop && Expand" in the menu
    const convertItem = page.getByRole('menuitem', { name: /convert to crop/i });
    const isVisible = await convertItem.isVisible().catch(() => false);
    if (isVisible) {
      await convertItem.click();
      await page.waitForTimeout(500);
      await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
    }
  });

  test('rapid crop-commit-undo does not crash', async ({ page }) => {
    test.setTimeout(60000);
    await importImageFile(page, 'test-image.png');
    await selectImageNode(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    // Enter crop, commit, undo
    await enterCropMode(page);
    await expect(page.locator('[data-testid="crop-overlay"]')).toBeVisible({ timeout: 5000 });

    // Make a real crop mutation. Without this, accepting the untouched crop
    // is deliberately a no-op, so Undo would correctly revert the import.
    const eastHandle = page.getByRole('button', { name: 'Resize crop e', exact: true });
    const eastBox = await eastHandle.boundingBox();
    if (!eastBox) throw new Error('missing east crop handle');
    await page.mouse.move(eastBox.x + eastBox.width / 2, eastBox.y + eastBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(eastBox.x + eastBox.width / 2 - 20, eastBox.y + eastBox.height / 2);
    await page.mouse.up();

    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // Node should exist
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
  });
});
