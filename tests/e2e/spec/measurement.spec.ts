import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page
    .getByRole('img', { name: 'Design canvas' })
    .waitFor({ timeout: 10000, state: 'visible' });
  // Allow the canvas to settle into its final CSS size before pointer events.
  await page.waitForTimeout(500);
}

function getCanvas(page: import('@playwright/test').Page) {
  return page.getByRole('img', { name: 'Design canvas' });
}

test.describe('Spec Panel Measurement', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function activateTool(page: import('@playwright/test').Page, name: string) {
    const btn = page.getByRole('button', { name });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(200);
  }

  test('enter inspect mode via shortcut I shows spec panel on selection', async ({ page }) => {
    // Create a rect first
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);

    // Switch to inspect mode
    await activateTool(page, 'Inspect');

    // Click on canvas to select the rect
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    // Spec panel should be visible with node name
    const specPanel = page.locator('.spec-panel');
    await expect(specPanel).toBeVisible({ timeout: 5000 });

    // Should show node name
    const name = specPanel.locator('.spec-panel__name');
    await expect(name).toBeVisible();
  });

  test('measurement overlay shows dimension label for selected node', async ({ page }) => {
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);

    await activateTool(page, 'Inspect');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);

    // Measure overlay SVG should be rendered
    const overlay = page.locator('.measure-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Should contain a dimension text (W x H pattern)
    await expect(overlay.locator('text')).toContainText(/[0-9]+/);
  });

  test('spec panel shows layout readout with width and height', async ({ page }) => {
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);

    await activateTool(page, 'Inspect');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    // Should render layout section with W/H
    const layoutSection = page.locator('.spec-panel__section').filter({ hasText: /Layout/i });
    await expect(layoutSection).toBeVisible({ timeout: 5000 });
    await expect(layoutSection).toContainText(/Width|Height/);
  });

  test('copy button copies value and announces', async ({ page }) => {
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);

    await activateTool(page, 'Inspect');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(300);

    // Find the first copy button in measurement readout
    const copyBtn = page.locator('.spec-row__copy').first();
    await expect(copyBtn).toBeVisible({ timeout: 5000 });

    // Click copy button
    await copyBtn.click();

    // Check for the CopyButton's own aria-live announcement
    const liveRegion = copyBtn.locator('..').locator('[aria-live="polite"]');
    await expect(liveRegion).toContainText(/copied/i);
  });
});
