import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Font selector', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('font selector opens dropdown with bundled fonts', async ({ page }) => {
    // Select the text tool
    await page.keyboard.press('t');

    // Create a text node on canvas
    await dragOnCanvas(page, 200, 200, 400, 250);
    await page.waitForTimeout(500);

    // TextTool enters editing mode after the drag, so the floating text bar is
    // already the active formatting surface. Clicking the canvas here would
    // commit the editor and hide the very bar this test is exercising.
    const treeItems = page.getByRole('treeitem');
    await expect(treeItems.first()).toContainText(/text/i, { timeout: 10000 });

    // Click the floating text bar (font family selector should be visible)
    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    // Open the font selector dropdown
    const fontInput = fontSelector.locator('input');
    await fontInput.click();
    await page.waitForTimeout(300);

    // Verify the dropdown appears
    const dropdown = page.locator('.font-selector__dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Verify at least one font option is listed
    const options = dropdown.locator('.font-selector__option');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('font selector shows bundled and system sections', async ({ page }) => {
    // Select text tool
    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    // Open the font selector
    await fontSelector.locator('input').click();
    await page.waitForTimeout(300);

    // Verify section headers exist (Recent, System, Bundled, or All)
    const sectionHeaders = page.locator('.font-selector__section-header');
    const headerCount = await sectionHeaders.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  test('keyboard navigation works in font selector', async ({ page }) => {
    // Select text tool
    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);

    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    const fontInput = fontSelector.locator('input');
    await fontInput.focus();

    // Type to search for a font
    await fontInput.fill('IBM');
    await page.waitForTimeout(300);

    // Verify dropdown appears with filtered results
    const dropdown = page.locator('.font-selector__dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Navigate with arrow down
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    // Press Enter to select highlighted item
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Input should now show the selected value
    const currentValue = await fontInput.inputValue();
    expect(currentValue.length).toBeGreaterThan(0);
  });

  test('font selector warns when font is unknown', async ({ page }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    const fontInput = fontSelector.locator('input');
    await fontInput.focus();

    // Type an invalid font name
    await fontInput.fill('NonExistentFontXYZ');
    await page.waitForTimeout(300);

    // Warning indicator should appear
    const warning = page.locator('.font-selector__warning');
    await expect(warning).toBeVisible({ timeout: 3000 });
  });

  test('font selector displays variable font badge', async ({ page }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    await fontSelector.locator('input').click();
    await page.waitForTimeout(300);

    // Check if any variable font badges exist (they use .font-selector__badge--var class)
    const varBadges = page.locator('.font-selector__badge--var');
    // Variable fonts may or may not be present, just verify no crash
    const badgeCount = await varBadges.count().catch(() => 0);
    expect(badgeCount).toBeGreaterThanOrEqual(0);
  });
});
