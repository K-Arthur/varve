import { expect, test } from '@playwright/test';
import { addLayerEffect, dragOnCanvas, navigateToEditor } from '../shared';

/** Locates the Layer Effects disclosure and expands it — the section is
 * collapsed by default (progressive disclosure), and the effect picker lives
 * in the section header. */
async function openEffectsSection(page: import('@playwright/test').Page) {
  const effectsSection = page.locator('section.insp-disclosure').filter({ hasText: 'Effects' });
  await expect(effectsSection).toBeVisible({ timeout: 5000 });
  const trigger = effectsSection.getByRole('button', { name: 'Layer Effects' });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  return effectsSection;
}

test.describe('Glass Material Effects', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    // Effects live in the merged Design tab; the old test targeted the
    // retired standalone Appearance tab.
    await page.getByRole('tab', { name: 'Design', exact: true }).click();
  });

  test('applies glass material to a rectangle and verifies effect controls appear', async ({
    page,
  }) => {
    // Create a rectangle using the Rect tool
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);

    // Wait for the shape to be selected and the inspector to render
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Open the Effects disclosure section if collapsed, then add the effect.
    // Choosing the type in the picker is the add action.
    const effectsSection = await openEffectsSection(page);
    await addLayerEffect(page, effectsSection, 'Glass Material');

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
    const effectsSection = await openEffectsSection(page);
    await addLayerEffect(page, effectsSection, 'Glass Material');

    // Address this effect's named colour control, independently of the
    // rectangle's Fill swatch and other retained, closed popovers.
    const tintSwatch = effectsSection.getByRole('button', { name: 'Glass tint', exact: true });
    await expect(tintSwatch).toBeVisible();
    const initialTint = await tintSwatch.evaluate((el) => getComputedStyle(el).backgroundColor);
    await tintSwatch.click();
    const picker = page.getByRole('dialog', { name: 'Pick Glass tint', exact: true });
    await expect(picker).toBeVisible();
    await picker.getByRole('option', { name: /teal 500/i }).click();
    await picker.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(picker).not.toBeVisible();
    await expect
      .poll(() => tintSwatch.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe(initialTint);
  });

  test('toggles edge highlight on glass material', async ({ page }) => {
    // Create a rectangle
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Add glass material
    const effectsSection = await openEffectsSection(page);
    await addLayerEffect(page, effectsSection, 'Glass Material');

    // Click the edge highlight switch (aria-label="Edge highlight")
    const edgeSwitch = page.getByRole('switch', { name: 'Edge highlight' });
    if (await edgeSwitch.isVisible()) {
      const checkedBefore = await edgeSwitch.isChecked();
      await edgeSwitch.click();
      await page.waitForTimeout(200);
      expect(await edgeSwitch.isChecked()).not.toBe(checkedBefore);
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
    const effectsSection = await openEffectsSection(page);
    await addLayerEffect(page, effectsSection, 'Glass Material');

    // Verify glass material controls rendered on the group
    const glassLabel = page.locator('text=Glass Material').first();
    await expect(glassLabel).toBeVisible({ timeout: 5000 });
  });
});
