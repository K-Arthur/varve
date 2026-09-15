import path from 'node:path';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

test.describe('LUT workflow', () => {
  test('can import .cube LUT and it appears in layers', async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 450, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#file-import-input').evaluate((el: HTMLInputElement) => el.click()),
    ]);
    await fileChooser.setFiles(path.join(FIXTURES_DIR, 'warm-look.cube'));
    await page.waitForTimeout(2000);

    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    const layersText = await page.locator('[data-panel="layers"]').textContent();
    expect(layersText).toContain('LUT');
    expect(layersText).toContain('warm-look');
  });

  test('LUT persists after undo/redo cycle', async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 450, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#file-import-input').evaluate((el: HTMLInputElement) => el.click()),
    ]);
    await fileChooser.setFiles(path.join(FIXTURES_DIR, 'warm-look.cube'));
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });

    // Redo
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(500);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 5000 });
  });
});
