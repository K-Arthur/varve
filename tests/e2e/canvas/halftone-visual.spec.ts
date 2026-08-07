/**
 * E2E: Visual verification of halftone effect.
 *
 * Tests the halftone adjustment panel UI and rendered canvas output
 * for correctness across multiple parameter combinations.
 */
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

const SCREENSHOT_DIR = 'test-results/halftone-visual';

async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByRole('button', { name: /rectangle/i }).first().click();
  await dragOnCanvas(page, x1, y1, x2, y2);
  await page.keyboard.press('v');
}

async function addHalftoneAdjustment(page: Page) {
  // Create an adjustment layer via the Object menu
  await page.getByRole('menuitem', { name: /^Object$/i }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await page.waitForTimeout(500);

  // Click "Add adjustment" button and select Halftone
  await page.getByRole('button', { name: /add adjustment/i }).click();
  await page.waitForTimeout(300);
  const halftoneOption = page.getByRole('menuitem', { name: /^Halftone$/i });
  await halftoneOption.scrollIntoViewIfNeeded();
  await halftoneOption.click();
  await page.waitForTimeout(800);
}

test.describe('Halftone visual verification', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('01 - Halftone on rectangle - default AM settings', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-rect-no-halftone.png`, fullPage: false });

    await addHalftoneAdjustment(page);

    // Screenshot with default halftone
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-rect-default-halftone.png`, fullPage: false });

    // Verify halftone controls are visible
    await expect(page.locator('text=Frequency')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Angle')).toBeVisible();
    await expect(page.locator('text=Threshold')).toBeVisible();
    await expect(page.locator('text=Intensity')).toBeVisible();
    await expect(page.locator('text=Softness')).toBeVisible();
    await expect(page.locator('text=Invert')).toBeVisible();
  });

  test('02 - Different frequencies', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    // Low frequency (coarse)
    const slider = page.locator('input[type="range"][aria-label*="frequency" i]');
    await slider.fill('10');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-freq-10-coarse.png`, fullPage: false });

    // High frequency (fine)
    await slider.fill('100');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-freq-100-fine.png`, fullPage: false });
  });

  test('03 - Different angles', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    const slider = page.locator('input[type="range"][aria-label*="angle" i]');
    await slider.fill('0');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-angle-0.png`, fullPage: false });

    await slider.fill('45');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/06-angle-45.png`, fullPage: false });
  });

  test('04 - Invert toggle', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-invert-off.png`, fullPage: false });

    const invertCheckbox = page.locator('#halftone-invert');
    await invertCheckbox.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/08-invert-on.png`, fullPage: false });
  });

  test('05 - Intensity blend', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    const slider = page.locator('input[type="range"][aria-label*="intensity" i]');
    await slider.fill('50');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/09-intensity-50.png`, fullPage: false });

    await slider.fill('0');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/10-intensity-0.png`, fullPage: false });
  });

  test('06 - Threshold', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    const slider = page.locator('input[type="range"][aria-label*="threshold" i]');
    await slider.fill('64');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/11-threshold-64.png`, fullPage: false });

    await slider.fill('200');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/12-threshold-200.png`, fullPage: false });
  });

  test('07 - Softness', async ({ page }) => {
    await drawRect(page, 100, 100, 600, 400);
    await addHalftoneAdjustment(page);

    const slider = page.locator('input[type="range"][aria-label*="softness" i]');
    await slider.fill('50');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/13-softness-50.png`, fullPage: false });
  });

  test('08 - Panel UI layout', async ({ page }) => {
    await drawRect(page, 100, 100, 400, 300);
    await addHalftoneAdjustment(page);

    // Screenshot the right panel
    const panel = page.locator('.adjustment-panel, .adj-editor, [class*="adjustment"]').first();
    if (await panel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await panel.screenshot({ path: `${SCREENSHOT_DIR}/14-panel-layout.png` });
    }

    // Verify key controls
    const controls = ['Method', 'Pattern', 'Dot Shape', 'Channel', 'Frequency', 'Angle', 'Invert'];
    for (const ctrl of controls) {
      const el = page.locator(`text=${ctrl}`).first();
      await expect(el).toBeVisible({ timeout: 3000 });
    }
  });
});
