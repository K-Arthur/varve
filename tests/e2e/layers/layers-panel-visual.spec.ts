import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers panel visual states', () => {
  test('captures the populated multi-selection panel', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await navigateToEditor(page);
    await seedLayers(page, 5);

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(200);
    const panel = page.getByTestId('layers-panel');
    const bulkBar = panel.locator('.layers-bulk-bar');
    await bulkBar.waitFor({ state: 'visible' });
    const geometry = await panel.evaluate((panelElement) => {
      const panelBox = panelElement.getBoundingClientRect();
      const bulkBox = panelElement.querySelector('.layers-bulk-bar')?.getBoundingClientRect();
      return {
        panelBottom: panelBox.bottom,
        bulkBottom: bulkBox?.bottom ?? Number.POSITIVE_INFINITY,
      };
    });
    expect(
      geometry.bulkBottom,
      'bulk layer actions must remain inside the Layers rail',
    ).toBeLessThanOrEqual(geometry.panelBottom + 1);

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.setAttribute('data-theme', nextTheme);
      }, theme);
      await panel.screenshot({
        path: testInfo.outputPath(`layers-panel-populated-${theme}.png`),
      });
    }
  });
});
