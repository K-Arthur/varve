import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

test.describe('Floating toolbar adapts per workspace mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  async function switchTo(page: import('@playwright/test').Page, label: string) {
    await page
      .locator('.workspace-tabs__tab')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .click();
  }

  test('Design mode: no paint/retouch tools, shapes and boolean ops available', async ({
    page,
  }) => {
    await expect(page.locator('[data-tool="paint"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="eraser"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="cloneStamp"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="pencil"]')).not.toBeVisible();
    await expect(page.getByLabel('Shapes menu')).toBeVisible();
    await expect(page.getByLabel('Boolean operations menu')).toBeVisible();
  });

  test('Print mode: no paint/retouch tools, shapes and boolean ops available', async ({ page }) => {
    await switchTo(page, 'Print');
    await expect(page.locator('[data-tool="paint"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="healBrush"]')).not.toBeVisible();
    await expect(page.getByLabel('Shapes menu')).toBeVisible();
    await expect(page.getByLabel('Boolean operations menu')).toBeVisible();
  });

  test('Drawing mode: paint/retouch tools available, boolean ops hidden', async ({ page }) => {
    await switchTo(page, 'Draw');
    await expect(page.locator('[data-tool="paint"]')).toBeVisible();
    await expect(page.locator('[data-tool="eraser"]')).toBeVisible();
    await expect(page.getByLabel('Boolean operations menu')).not.toBeVisible();
  });

  test('Photo mode: frame and boolean ops hidden, retouch tools available', async ({ page }) => {
    await switchTo(page, 'Photo');
    await expect(page.locator('[data-tool="frame"]')).not.toBeVisible();
    await expect(page.getByLabel('Boolean operations menu')).not.toBeVisible();
    await expect(page.locator('[data-tool="cloneStamp"]')).toBeVisible();
    await expect(page.locator('[data-tool="healBrush"]')).toBeVisible();
    await expect(page.locator('[data-tool="spotHeal"]')).toBeVisible();
    await expect(page.getByLabel('Shapes menu')).toBeVisible();
  });
});
