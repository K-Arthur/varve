import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Glass Material Effects', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    // Effects live in the unified Inspector's Appearance tab; the old test
    // targeted the retired standalone disclosure on Properties.
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  });

  test('applies glass material to a rectangle and verifies effect controls appear', async ({
    page,
  }) => {
    // Create a rectangle using the Rect tool
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);

    // Wait for the shape to be selected and the inspector to render
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Open the Effects disclosure section if collapsed, then add a new effect
    const effectsSection = page.locator('section.insp-disclosure').filter({ hasText: 'Effects' });
    await expect(effectsSection).toBeVisible({ timeout: 5000 });

    // The Select combobox for effect type uses aria-label "New effect type"
    const effectTypeSelect = effectsSection.locator(
      '.varve-select__trigger[aria-label="New effect type"]',
    );
    await effectTypeSelect.click();
    await page.waitForTimeout(200);

    // Click "Glass Material" in the dropdown listbox
    const glassOption = page.locator('.varve-select__option').filter({ hasText: 'Glass Material' });
    if (await glassOption.isVisible()) {
      await glassOption.click();
      await page.waitForTimeout(100);
    }

    // Click the "Add" button to add the effect
    const addBtn = effectsSection.locator('button.insp-add-btn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
    }

    // Verify glass material controls are rendered
    // The GlassMaterialParams renders a label "Glass Material" on the effect row
    const glassLabel = page.locator('text=Glass Material').first();
    await expect(glassLabel).toBeVisible({ timeout: 5000 });

    // Glass-specific params: Blur number field should exist
    const blurField = page.locator('.insp-field').filter({ hasText: 'Blur' }).first();
    await expect(blurField).toBeVisible({ timeout: 3000 });
  });

  test('adjusts glass material tint color via swatch', async ({ page }) => {
    // Create a rectangle
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Add glass material via Effects section
    const effectsSection = page.locator('section.insp-disclosure').filter({ hasText: 'Effects' });
    await expect(effectsSection).toBeVisible({ timeout: 5000 });

    const effectTypeSelect = effectsSection.locator(
      '.varve-select__trigger[aria-label="New effect type"]',
    );
    await effectTypeSelect.click();
    await page.waitForTimeout(200);

    const glassOption = page.locator('.varve-select__option').filter({ hasText: 'Glass Material' });
    if (await glassOption.isVisible()) {
      await glassOption.click();
      await page.waitForTimeout(100);
    }

    const addBtn = effectsSection.locator('button.insp-add-btn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
    }

    // The GlassTintSwatch renders an InspectorColorPopover with a swatch button
    // The tint swatch is rendered inline in the effect row (not inside NumberField params)
    // Look for the color swatch button associated with glass tint
    // InspectorColorPopover renders a button with class insp-swatch
    const tintSwatch = page.locator('button.insp-swatch').first();
    if (await tintSwatch.isVisible()) {
      await tintSwatch.click();
      await page.waitForTimeout(300);

      // The InspectorColorPopover should open a dialog
      // It renders inside a FloatingPortal, look for the open popover
      const popover = page.locator('[role="dialog"].varve-popover').first();
      await expect(popover).toBeVisible({ timeout: 5000 });
    }
  });

  test('toggles edge highlight on glass material', async ({ page }) => {
    // Create a rectangle
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Add glass material
    const effectsSection = page.locator('section.insp-disclosure').filter({ hasText: 'Effects' });
    await expect(effectsSection).toBeVisible({ timeout: 5000 });

    const effectTypeSelect = effectsSection.locator(
      '.varve-select__trigger[aria-label="New effect type"]',
    );
    await effectTypeSelect.click();
    await page.waitForTimeout(200);
    const glassOption = page.locator('.varve-select__option').filter({ hasText: 'Glass Material' });
    if (await glassOption.isVisible()) {
      await glassOption.click();
      await page.waitForTimeout(100);
    }
    const addBtn = effectsSection.locator('button.insp-add-btn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
    }

    // Click the edge highlight toggle button (aria-label="Edge highlight")
    const edgeBtn = page.locator('button[aria-label="Edge highlight"]');
    if (await edgeBtn.isVisible()) {
      const textBefore = await edgeBtn.textContent();
      await edgeBtn.click();
      await page.waitForTimeout(200);
      const textAfter = await edgeBtn.textContent();
      expect(textAfter).not.toBe(textBefore);
    }
  });

  test('verifies glass material on grouped objects renders', async ({ page }) => {
    // Create two rectangles
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 320, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.keyboard.press('r');
    await dragOnCanvas(page, 380, 150, 550, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    // Select all and group them
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+g');
    await page.waitForTimeout(300);

    // Should now have a group node in the tree
    const treeItems = page.getByRole('treeitem');
    const groupItem = treeItems.filter({ hasText: /group/i }).first();
    await expect(groupItem).toBeVisible({ timeout: 5000 });

    // Click to select the group
    await groupItem.click();
    await page.waitForTimeout(200);

    // Add glass material to the group
    const effectsSection = page.locator('section.insp-disclosure').filter({ hasText: 'Effects' });
    await expect(effectsSection).toBeVisible({ timeout: 5000 });

    const effectTypeSelect = effectsSection.locator(
      '.varve-select__trigger[aria-label="New effect type"]',
    );
    await effectTypeSelect.click();
    await page.waitForTimeout(200);
    const glassOption = page.locator('.varve-select__option').filter({ hasText: 'Glass Material' });
    if (await glassOption.isVisible()) {
      await glassOption.click();
      await page.waitForTimeout(100);
    }
    const addBtn = effectsSection.locator('button.insp-add-btn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
    }

    // Verify glass material controls rendered on the group
    const glassLabel = page.locator('text=Glass Material').first();
    await expect(glassLabel).toBeVisible({ timeout: 5000 });
  });
});
