import { expect, test } from '@playwright/test';

const THEMES = ['light', 'dark', 'high-contrast'] as const;

import { navigateToEditor } from '../shared';

async function createVerticalGuide(page: import('@playwright/test').Page) {
  const topRuler = page.locator('.ruler-canvas--top');
  await expect(topRuler).toBeVisible();
  const topBox = await topRuler.boundingBox();
  if (!topBox) throw new Error('top ruler not found');

  await page.mouse.move(topBox.x + 120, topBox.y + topBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(topBox.x + 160, topBox.y + topBox.height / 2);
  await page.mouse.up();
}

for (const theme of THEMES) {
  test.describe(`Guide overlay visual (${theme})`, () => {
    test.describe.configure({ mode: 'serial' });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('strata-theme', t);
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await navigateToEditor(page);
      await createVerticalGuide(page);
      await expect(page.locator('.guide-overlay__line')).toHaveCount(1, { timeout: 10000 });
    });

    test(`guide overlay matches snapshot (${theme})`, async ({ page }) => {
      const overlay = page.locator('.guide-overlay');
      await expect(overlay).toHaveScreenshot(`guides-overlay-${theme}.png`, {
        maxDiffPixels: 120,
      });
    });
  });
}
