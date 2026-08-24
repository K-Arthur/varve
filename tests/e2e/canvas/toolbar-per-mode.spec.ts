import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

test.describe('Floating toolbar adapts per workspace mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  async function switchTo(page: import('@playwright/test').Page, label: string) {
    const workspace = page.getByRole('radio', { name: `${label} workspace` });
    if (await workspace.isVisible({ timeout: 1000 }).catch(() => false)) {
      await workspace.click();
      return;
    }
    await page.getByLabel('More workspaces').click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${label}(?:\\s|$)`, 'i') }).click();
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
    await expect(page.getByLabel('Retouch menu')).toBeVisible();
    await page.getByLabel('Retouch menu').click();
    await expect(page.getByRole('menuitem', { name: 'Clone Stamp' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Healing Brush' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Spot Heal' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Retouch menu')).toBeVisible();
  });
});
