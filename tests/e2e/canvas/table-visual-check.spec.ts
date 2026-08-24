/**
 * Quick visual check: insert table, take screenshots at key states.
 * No variable creation (avoids crash from unrelated workspace changes).
 */
import { expect, test } from '@playwright/test';
import { activateTableTool, dragOnCanvas, navigateToEditor } from '../shared';

test('table visual check with inspector', async ({ page }) => {
  await navigateToEditor(page);

  // Insert table
  await activateTableTool(page);
  await dragOnCanvas(page, 200, 160, 700, 460);
  await page.waitForTimeout(500);

  // Screenshot 1: fresh table
  await page.screenshot({ path: 'test-results/visual/check-01-fresh-table.png', fullPage: false });

  // Add rows via inspector
  const addRowBtn = page.getByRole('button', { name: /add row/i });
  if (await addRowBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addRowBtn.click();
    await addRowBtn.click();
  }

  // Screenshot 2: more rows
  await page.screenshot({ path: 'test-results/visual/check-02-more-rows.png', fullPage: false });

  // Set header rows
  const headerInput = page.getByRole('spinbutton', { name: /header rows/i });
  if (await headerInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await headerInput.fill('1');
    await headerInput.press('Enter');
  }

  // Screenshot 3: header set
  await page.screenshot({ path: 'test-results/visual/check-03-header.png', fullPage: false });

  // Toggle zebra
  const zebra = page.getByRole('checkbox', { name: /zebra/i });
  if (await zebra.isVisible({ timeout: 2000 }).catch(() => false)) {
    await zebra.check();
  }

  // Screenshot 4: zebra
  await page.screenshot({ path: 'test-results/visual/check-04-zebra.png', fullPage: false });

  // Set frozen rows
  const frozenInput = page.getByRole('spinbutton', { name: /frozen rows/i });
  if (await frozenInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await frozenInput.fill('1');
    await frozenInput.press('Enter');
  }

  // Screenshot 5: frozen
  await page.screenshot({ path: 'test-results/visual/check-05-frozen.png', fullPage: false });

  // Enter edit mode, type text
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.dblclick({ position: { x: 350, y: 300 } });
  await expect(page.locator('.table-edit-overlay')).toBeVisible({ timeout: 10000 });

  await page.locator('.table-edit-overlay').click({ position: { x: 300, y: 280 } });
  await page.keyboard.press('Enter');
  const editor = page.locator('textarea.table-cell-editor');
  await expect(editor).toBeVisible({ timeout: 5000 });
  await editor.fill('Widget');
  await page.keyboard.press('Enter');

  // Navigate and type in another cell
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await editor.fill('$9.99');
  await page.keyboard.press('Enter');

  // Screenshot 6: with content
  await page.screenshot({ path: 'test-results/visual/check-06-content.png', fullPage: false });

  // Merge two header cells
  await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Merge cells' }).click();

  // Screenshot 7: merged
  await page.screenshot({ path: 'test-results/visual/check-07-merged.png', fullPage: false });

  await page.keyboard.press('Escape');

  // Scroll down inspector to see full table section
  await page.evaluate(() => {
    const inspector = document.querySelector('.editor-inspector');
    if (inspector) inspector.scrollTop = inspector.scrollHeight;
  });
  await page.waitForTimeout(200);

  // Screenshot 8: full inspector
  await page.screenshot({
    path: 'test-results/visual/check-08-inspector-bottom.png',
    fullPage: false,
  });
});
