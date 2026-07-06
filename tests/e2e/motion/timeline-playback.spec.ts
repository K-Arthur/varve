import { expect, test } from '@playwright/test';
import { createTimelineInEditor, navigateToEditor } from './helpers';

test.describe('Timeline playback', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
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

  test('double-click ruler adds a marker', async ({ page }) => {
    await createTimelineInEditor(page);
    const ruler = page.locator('.timeline-ruler');
    await expect(ruler).toBeVisible();
    await ruler.dblclick({ position: { x: 100, y: 8 } });
    await expect(page.locator('.timeline-ruler__marker')).toHaveCount(1);
  });

  test('create timeline button exposes timeline in selector', async ({ page }) => {
    await createTimelineInEditor(page);
    const selector = page.getByLabel('Select timeline');
    await expect(selector).toHaveValue(/.+/);
    await expect(selector.locator('option', { hasText: 'Timeline 1' })).toHaveCount(1);
  });
});
