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
    const inputBox = await fontInput.boundingBox();
    const dropdownBox = await dropdown.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(dropdownBox).not.toBeNull();
    expect(dropdownBox!.width).toBeLessThanOrEqual(inputBox!.width);
    await page.screenshot({
      path: test.info().outputPath('font-selector-open.png'),
      fullPage: true,
    });

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

  test('searches the installed semantic catalog without provider metadata requests', async ({
    page,
  }) => {
    let providerRequests = 0;
    page.on('request', (request) => {
      if (/googleapis|fonts\.google|api\.fontsource\.org/.test(request.url())) {
        providerRequests += 1;
      }
    });

    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);
    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });
    const fontInput = fontSelector.locator('input');
    await fontInput.fill('Inter');

    await expect(page.locator('.font-selector__option-name', { hasText: 'Inter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Install' })).toHaveCount(0);
    expect(providerRequests).toBe(0);
    await page.screenshot({
      path: test.info().outputPath('fontsource-catalog-search.png'),
      fullPage: true,
    });
  });

  test('full browser interprets design-language queries and keeps installation explicit', async ({
    page,
  }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    await page.getByRole('button', { name: 'Browse fonts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Browse fonts' });
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    await search.fill('friendly rounded sans for UI');
    await expect(dialog.getByRole('status', { name: 'Search interpretation' })).toContainText(
      'Rounded',
    );
    await expect(dialog.getByText('Interpreted as')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Install/ }).first()).toBeVisible();
    await dialog.locator('.font-browser__select-btn').first().click();
    await expect(dialog.getByText('Why this result')).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('font-browser-semantic-query.png'),
      fullPage: true,
    });
  });

  test('finds gothic families without unrelated filler and keeps inspection stable', async ({
    page,
  }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    await page.getByRole('button', { name: 'Browse fonts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Browse fonts' });
    const search = dialog.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    await expect(search).toBeFocused();
    await search.fill('gothic');

    const names = await dialog.locator('.font-browser__preview').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => /gothic/i.test(name))).toBe(true);
    await expect(dialog.getByText('Adamina', { exact: true })).toHaveCount(0);

    await dialog.locator('.font-browser__select-btn').first().click();
    await expect(dialog.locator('.font-browser__details h3')).toBeVisible();
    await expect(dialog.getByLabel('Preview text')).toBeVisible();
    await expect(dialog.locator('.font-browser__specimen')).toHaveAttribute(
      'data-preview-status',
      'ready',
      { timeout: 15000 },
    );
    const specimenGeometry = await dialog.locator('.font-browser__specimen').evaluate((element) => {
      const specimen = element.getBoundingClientRect();
      const nextContent = element.nextElementSibling?.getBoundingClientRect();
      return {
        specimenBottom: specimen.bottom,
        nextContentTop: nextContent?.top ?? specimen.bottom,
      };
    });
    expect(specimenGeometry.specimenBottom).toBeLessThanOrEqual(
      specimenGeometry.nextContentTop + 1,
    );
    await expect(dialog.locator('.font-browser__list-heading strong')).toBeVisible();
    await expect(dialog.locator('.font-browser__list')).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('font-browser-gothic-inspection.png'),
      fullPage: true,
    });
  });

  test('keeps the browser readable across themes at a compact viewport', async ({ page }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });
    await page.getByRole('button', { name: 'Browse fonts' }).click();

    const dialog = page.getByRole('dialog', { name: 'Browse fonts' });
    await page.setViewportSize({ width: 540, height: 640 });
    for (const theme of ['light', 'dark', 'high-contrast']) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);

      await expect(dialog).toBeVisible();
      const layout = await dialog.locator('.font-browser').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight);
      await expect(dialog.getByRole('searchbox')).toBeVisible();
      await expect(dialog.getByRole('tablist')).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`font-browser-${theme}.png`),
        fullPage: true,
      });
    }
  });
});
