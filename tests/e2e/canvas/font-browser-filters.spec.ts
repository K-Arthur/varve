import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Font browser filter reset', () => {
  test('restores the complete local catalog from a combined filter at a narrow width', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    await page.getByRole('button', { name: 'Browse fonts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Browse fonts' });
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 540, height: 640 });

    const search = dialog.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    await search.fill('gothic');
    await dialog.getByRole('tab', { name: 'Favorites' }).click();
    await dialog.getByRole('combobox', { name: 'Semantic font filter' }).selectOption('variable');

    const reset = dialog.getByRole('button', { name: 'Reset font browser filters' });
    await expect(reset).toBeVisible();
    const layout = await dialog.locator('.font-browser__toolbar').evaluate((element) => {
      const controls = element.querySelector<HTMLElement>('.font-browser__controls');
      const button = element.querySelector<HTMLElement>('.font-browser__reset-button');
      if (!controls || !button) throw new Error('font browser filter controls are missing');
      const controlsStyle = getComputedStyle(controls);
      return {
        toolbarWidth: element.clientWidth,
        toolbarScrollWidth: element.scrollWidth,
        controlsDirection: controlsStyle.flexDirection,
        resetWidth: button.getBoundingClientRect().width,
        controlsWidth: controls.getBoundingClientRect().width,
      };
    });
    expect(layout.toolbarScrollWidth).toBeLessThanOrEqual(layout.toolbarWidth);
    expect(layout.controlsDirection).toBe('column');
    expect(layout.resetWidth).toBeCloseTo(layout.controlsWidth, 0);
    await page.screenshot({
      path: test.info().outputPath('font-browser-filtered-narrow.png'),
      animations: 'disabled',
      fullPage: true,
    });

    await reset.click();
    await expect(search).toHaveValue('');
    await expect(dialog.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('combobox', { name: 'Semantic font filter' })).toHaveValue('all');
    await expect(dialog.getByRole('button', { name: 'Reset font browser filters' })).toHaveCount(0);

    const allTab = dialog.getByRole('tab', { name: 'All' });
    const systemTab = dialog.getByRole('tab', { name: 'System' });
    const favoritesTab = dialog.getByRole('tab', { name: 'Favorites' });
    await allTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(systemTab).toHaveAttribute('aria-selected', 'true');
    await expect(systemTab).toHaveAttribute('tabindex', '0');
    await expect(allTab).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('End');
    await expect(favoritesTab).toHaveAttribute('aria-selected', 'true');
    await expect(favoritesTab).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Home');
    await expect(allTab).toHaveAttribute('aria-selected', 'true');
    await expect(allTab).toBeFocused();

    const familyRows = dialog.locator('.font-browser__select-btn');
    await expect(familyRows.first()).toHaveAttribute('tabindex', '0');
    await familyRows.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(familyRows.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(familyRows.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(familyRows.last()).toHaveAttribute('tabindex', '0');
    await expect(familyRows.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(familyRows.first()).toBeFocused();

    await page.screenshot({
      path: test.info().outputPath('font-browser-reset-narrow.png'),
      animations: 'disabled',
      fullPage: true,
    });
  });
});
