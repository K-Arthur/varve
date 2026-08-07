import { test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test('table inspector layout fix', async ({ page }) => {
  await navigateToEditor(page);
  await page.getByRole('button', { name: 'Table', exact: true }).first().click();
  await dragOnCanvas(page, 200, 160, 700, 460);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/visual/table-inspector-fixed.png', fullPage: false });
});
