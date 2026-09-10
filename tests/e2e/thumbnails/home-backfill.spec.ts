import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function installSavePickerStub(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    win.showSaveFilePicker = async () => ({
      name: 'home-backfill.varve',
      queryPermission: async () => 'granted',
      createWritable: async () => ({
        write: async () => undefined,
        close: async () => undefined,
      }),
    });
  });
}

async function clearThumbnailCache(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('varve-home');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('thumbnails', 'readwrite');
          transaction.objectStore('thumbnails').clear();
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
}

test('Home repairs a missing thumbnail from the saved document', async ({ page }, testInfo) => {
  await installSavePickerStub(page);
  await navigateToEditor(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = (await canvas.boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 160, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

  await page.keyboard.press('Control+s');
  await page.waitForTimeout(2000);
  await clearThumbnailCache(page);

  await page.keyboard.press('Control+Shift+H');
  await page.locator('.varve-home').waitFor({ timeout: 20000 });
  const card = page.locator('.file-card').first();
  await card.waitFor({ timeout: 20000 });
  const image = card.locator('.varve-thumbnail__img');
  await expect(image).toBeVisible({ timeout: 30000 });
  await expect(image).toHaveAttribute('src', /^data:image\/(png|webp)/);
  await page.screenshot({
    path: testInfo.outputPath('home-thumbnail-backfill.png'),
    fullPage: true,
  });
});
