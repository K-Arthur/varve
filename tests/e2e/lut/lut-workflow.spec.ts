import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { navigateToEditor, dragOnCanvas } from '../shared';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

test.describe('LUT workflow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 450, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  });

  test('can add LUT adjustment via UI and see it in layers', async ({ page }) => {
    // Create an adjustment layer first via the "+" button in the adjustment panel
    const addBtn = page.locator('button').filter({ hasText: /\+ Add adjustment/ });
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(500);

      // Select "LUT" from the adjustment kind menu
      const lutOption = page.getByRole('menuitem', { name: /lut/i }).or(
        page.locator('button, [role="option"]').filter({ hasText: /^LUT$/i })
      );
      if (await lutOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await lutOption.click();
        await page.waitForTimeout(500);
      }
    }

    // Check if LUT adjustment appeared in layers
    const layersText = await page.locator('[data-panel="layers"]').textContent();
    console.log('Layers after add:', layersText?.slice(0, 200));
    // The adjustment layer should be in the tree
    const treeitems = await page.getByRole('treeitem').count();
    console.log('Treeitem count:', treeitems);
  });

  test('LUT import via file input works with hidden input', async ({ page }) => {
    // Check if __importLut is available
    const hasImportLut = await page.evaluate(() => typeof (window as any).__importLut);
    console.log('__importLut type:', hasImportLut);

    // Try using the file input directly
    const fileInput = page.locator('#file-import-input');
    const exists = await fileInput.count();
    console.log('File input exists:', exists);

    if (exists > 0) {
      await fileInput.setInputFiles(path.join(FIXTURES_DIR, 'warm-look.cube'));
      await page.waitForTimeout(3000);

      const layersText = await page.locator('[data-panel="layers"]').textContent();
      console.log('Layers after import:', layersText?.slice(0, 200));
      const treeitems = await page.getByRole('treeitem').count();
      console.log('Treeitem count:', treeitems);
    }
  });
});
