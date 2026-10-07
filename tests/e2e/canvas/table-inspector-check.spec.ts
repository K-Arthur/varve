import { expect, test } from '@playwright/test';
import { activateTableTool, dragOnCanvas, navigateToEditor } from '../shared';

// Preserve authored geometry while keeping the complete drawing fixture visible.
test.use({ viewport: { width: 1440, height: 1000 } });

test('table inspector layout fix', async ({ page }) => {
  await navigateToEditor(page);
  await activateTableTool(page);
  await dragOnCanvas(page, 200, 160, 700, 460);
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByRole('treeitem')).toContainText(/table/i);
  await expect(
    page
      .getByRole('tabpanel', { name: 'Design', exact: true })
      .getByRole('button', { name: 'Table', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/visual/table-inspector-fixed.png', fullPage: false });
});
