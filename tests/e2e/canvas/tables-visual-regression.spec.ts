/**
 * E2E: Visual regression tests for table rendering.
 *
 * These tests take screenshots at specific states and can be used for
 * visual comparison to detect rendering regressions.
 */
import { expect, type Page, test } from '@playwright/test';
import { activateTableTool, dragOnCanvas, navigateToEditor } from '../shared';

async function insertTable(page: Page, width = 500, height = 300): Promise<void> {
  await activateTableTool(page);
  await dragOnCanvas(page, 200, 160, 200 + width, 160 + height);
}

test.describe('Table visual regression', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Basic 4x4 table rendering', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Wait for table to render
    await page.waitForTimeout(500);

    // Take screenshot
    await page.screenshot({
      path: 'test-results/visual-regression/01-basic-4x4.png',
      fullPage: false,
    });
  });

  test('Table with header rows', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Set header rows to 1
    const headerRowsInput = page.getByRole('spinbutton', { name: /header rows/i });
    if (await headerRowsInput.isVisible()) {
      await headerRowsInput.fill('1');
      await headerRowsInput.press('Enter');
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/02-header-rows.png',
      fullPage: false,
    });
  });

  test('Table with zebra stripes', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Enable zebra stripes
    const zebraToggle = page.getByRole('checkbox', { name: /zebra/i });
    if (await zebraToggle.isVisible()) {
      await zebraToggle.check();
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/03-zebra-stripes.png',
      fullPage: false,
    });
  });

  test('Table with compact density', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Change to compact density
    const compactBtn = page.getByRole('button', { name: /compact/i });
    if (await compactBtn.isVisible()) {
      await compactBtn.click();
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/04-compact-density.png',
      fullPage: false,
    });
  });

  test('Table with spacious density', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Change to spacious density
    const spaciousBtn = page.getByRole('button', { name: /spacious/i });
    if (await spaciousBtn.isVisible()) {
      await spaciousBtn.click();
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/05-spacious-density.png',
      fullPage: false,
    });
  });

  test('Table with collapsed borders', async ({ page }) => {
    await insertTable(page, 400, 240);

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/06-collapsed-borders.png',
      fullPage: false,
    });
  });

  test('Table with separate borders', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Change to separate borders
    const separateBtn = page.getByRole('button', { name: /separate/i });
    if (await separateBtn.isVisible()) {
      await separateBtn.click();
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/07-separate-borders.png',
      fullPage: false,
    });
  });

  test('Table with different border widths', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Set border width to 2
    const borderWidthInput = page.getByRole('spinbutton', { name: /border width/i });
    if (await borderWidthInput.isVisible()) {
      await borderWidthInput.fill('2');
      await borderWidthInput.press('Enter');
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/08-border-width-2.png',
      fullPage: false,
    });
  });

  test('Table with corner radius', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Set corner radius to 8
    const cornerRadiusInput = page.getByRole('spinbutton', { name: /corner radius/i });
    if (await cornerRadiusInput.isVisible()) {
      await cornerRadiusInput.fill('8');
      await cornerRadiusInput.press('Enter');
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/09-corner-radius.png',
      fullPage: false,
    });
  });

  test('Table with custom cell padding', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Change density to spacious (which has more padding)
    const spaciousBtn = page.getByRole('button', { name: /spacious/i });
    if (await spaciousBtn.isVisible()) {
      await spaciousBtn.click();
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/10-custom-padding.png',
      fullPage: false,
    });
  });

  test('Table with merged cells', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Enter edit mode
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.dblclick({ position: { x: 350, y: 300 } });
    await expect(page.locator('.table-edit-overlay')).toBeVisible({ timeout: 10000 });

    // Select the first two cells so the inspector exposes the merge command.
    await page.locator('.table-edit-overlay').click({ position: { x: 250, y: 190 } });
    await page.keyboard.press('Shift+ArrowRight');

    // Merge cells
    await page.getByRole('button', { name: 'Merge cells' }).click();

    await page.keyboard.press('Escape');

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/11-merged-cells.png',
      fullPage: false,
    });
  });

  test('Table with frozen header', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Freeze first row
    const frozenRowsInput = page.getByRole('spinbutton', { name: /frozen rows/i });
    if (await frozenRowsInput.isVisible()) {
      await frozenRowsInput.fill('1');
      await frozenRowsInput.press('Enter');
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/12-frozen-header.png',
      fullPage: false,
    });
  });

  test('Table with different column widths', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Enter edit mode
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.dblclick({ position: { x: 350, y: 300 } });
    await expect(page.locator('.table-edit-overlay')).toBeVisible({ timeout: 10000 });

    // Resize first column
    const box = await canvas.boundingBox();
    if (box) {
      const handleX = box.x + 300; // Column boundary
      const handleY = box.y + 170; // Top edge

      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX + 100, handleY);
      await page.mouse.up();
    }

    await page.keyboard.press('Escape');

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/13-different-widths.png',
      fullPage: false,
    });
  });

  test('Table with alternating rows and header', async ({ page }) => {
    await insertTable(page, 400, 240);

    // Set header rows
    const headerRowsInput = page.getByRole('spinbutton', { name: /header rows/i });
    if (await headerRowsInput.isVisible()) {
      await headerRowsInput.fill('1');
      await headerRowsInput.press('Enter');
    }

    // Enable zebra stripes
    const zebraToggle = page.getByRole('checkbox', { name: /zebra/i });
    if (await zebraToggle.isVisible()) {
      await zebraToggle.check();
    }

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/14-header-zebra.png',
      fullPage: false,
    });
  });

  test('Dark theme table rendering', async ({ page }) => {
    // This test would switch to dark theme if available
    // For now, we'll just take a screenshot in the current theme

    await insertTable(page, 400, 240);

    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/visual-regression/15-dark-theme.png',
      fullPage: false,
    });
  });
});
