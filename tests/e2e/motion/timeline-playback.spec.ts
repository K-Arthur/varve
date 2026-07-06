import { expect, test } from '@playwright/test';

test.describe('Timeline playback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.editor-shell');
  });

  test('timeline panel is visible in editor shell', async ({ page }) => {
    const panel = page.locator('.timeline-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('No timeline selected')).toBeVisible();
  });

  test('timeline selector has accessible label', async ({ page }) => {
    const selector = page.getByLabel('Select timeline');
    await expect(selector).toBeVisible();
  });

  test('toggle timeline panel shortcut hides panel', async ({ page }) => {
    const panel = page.locator('.timeline-panel');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Control+Alt+t');
    await expect(panel).not.toBeVisible();
    await page.keyboard.press('Control+Alt+t');
    await expect(panel).toBeVisible();
  });
});
