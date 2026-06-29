import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('button:has-text("New File")', { timeout: 10000 });
  await page.getByRole('button', { name: /new file/i }).click();
  await page.waitForSelector('button:has-text("Create")', { timeout: 5000 });
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.waitForSelector('.layers-panel', { timeout: 10000 });
}

test.describe('Spec Panel Measurement', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('enter inspect mode via shortcut I shows spec panel on selection', async ({ page }) => {
    // Create a rect first
    await page.keyboard.press('r');
    const canvas = page.locator('canvas').first();
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    // Switch to inspect mode
    await page.keyboard.press('i');

    // Click on canvas to select the rect
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    // Spec panel should be visible with node name
    const specPanel = page.locator('.spec-panel');
    await expect(specPanel).toBeVisible({ timeout: 5000 });

    // Should show node name
    const name = specPanel.locator('.spec-panel__name');
    await expect(name).toBeVisible();
  });

  test('measurement overlay shows dimension label for selected node', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas').first();
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    await page.keyboard.press('i');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);

    // Measure overlay SVG should be rendered
    const overlay = page.locator('.measure-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Should contain a dimension text (W x H pattern)
    await expect(overlay.locator('text')).toContainText(/[0-9]+/);
  });

  test('spec panel shows layout readout with width and height', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas').first();
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    await page.keyboard.press('i');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    // Should render layout section with W/H
    const layoutSection = page.locator('.spec-panel__section').filter({ hasText: /Layout/i });
    await expect(layoutSection).toBeVisible({ timeout: 5000 });
    await expect(layoutSection).toContainText(/Width|Height/);
  });

  test('copy button copies value and announces', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas').first();
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    await page.keyboard.press('i');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    // Find the first copy button in measurement readout
    const copyBtn = page.locator('.spec-row__copy').first();
    await expect(copyBtn).toBeVisible({ timeout: 5000 });

    // Click copy button
    await copyBtn.click();

    // Check for aria-live announcement (strata-visually-hidden with role="status")
    const liveRegion = page.locator('[aria-live="polite"]');
    await expect(liveRegion).toContainText(/copied/i);
  });
});
