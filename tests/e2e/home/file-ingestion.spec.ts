import { expect, test } from '@playwright/test';
import { navigateToHome } from '../shared';

async function openAssetBrowser(page: import('@playwright/test').Page) {
  await navigateToHome(page);
  await page
    .getByRole('button', { name: /assets/i })
    .first()
    .click();
  await page.locator('.asset-browser').waitFor({ state: 'visible', timeout: 15000 });
}

async function dispatchFileDrop(
  target: import('@playwright/test').Locator,
  file: { name: string; type: string; body: string },
  events: Array<'dragenter' | 'dragover' | 'dragleave' | 'drop'> = [
    'dragenter',
    'dragover',
    'drop',
  ],
) {
  await target.evaluate(
    (element, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([payload.body], payload.name, { type: payload.type }));
      for (const eventName of payload.events) {
        element.dispatchEvent(
          new DragEvent(eventName, { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      }
    },
    { ...file, events },
  );
}

test('asset drop zone handles real drag states, processing, and completion', async ({
  page,
}, testInfo) => {
  await openAssetBrowser(page);
  const zone = page.locator('.asset-browser .file-drop-zone');

  await dispatchFileDrop(
    zone,
    { name: 'dropped-mark.svg', type: 'image/svg+xml', body: '<svg viewBox="0 0 1 1" />' },
    ['dragenter'],
  );
  await expect(zone).toHaveAttribute('data-state', 'drag-active');
  await page.screenshot({ path: testInfo.outputPath('asset-drag-active.png'), fullPage: true });
  await dispatchFileDrop(
    zone,
    {
      name: 'dropped-mark.svg',
      type: 'image/svg+xml',
      body: '<svg viewBox="0 0 1 1" />',
    },
    ['dragleave'],
  );
  await expect(zone).toHaveAttribute('data-state', 'idle');

  await page.locator('.asset-browser input[type="file"]').setInputFiles({
    name: 'empty-mark.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.alloc(0),
  });
  await expect(zone).toHaveAttribute('data-state', 'rejected');
  await expect(page.getByRole('alert')).toContainText(/empty-mark\.svg/i);
  await page.screenshot({ path: testInfo.outputPath('asset-rejected.png'), fullPage: true });
  await page.waitForTimeout(1900);

  await dispatchFileDrop(zone, {
    name: 'dropped-mark.svg',
    type: 'image/svg+xml',
    body: '<svg viewBox="0 0 1 1" />',
  });
  await expect(zone).toHaveAttribute('data-state', /processing|accepted/);
  await page.screenshot({ path: testInfo.outputPath('asset-after-drop.png'), fullPage: true });
  await expect(
    page.locator('.asset-browser__card-name').filter({ hasText: 'dropped-mark.svg' }).first(),
  ).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    localStorage.setItem('varve-theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(1900);
  await page.screenshot({ path: testInfo.outputPath('asset-dark-idle.png'), fullPage: true });
});
