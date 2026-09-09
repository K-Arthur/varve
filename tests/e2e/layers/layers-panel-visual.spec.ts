import { test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers panel visual states', () => {
  test('captures the populated multi-selection panel', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await navigateToEditor(page);
    await seedLayers(page, 5);

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });

    await page.getByTestId('layers-panel').screenshot({
      path: testInfo.outputPath('layers-panel-populated.png'),
    });
  });
});
