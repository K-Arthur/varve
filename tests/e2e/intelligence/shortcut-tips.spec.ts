import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function seedShortcutTip(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.removeItem('strata:dismissed-tips');
    localStorage.setItem(
      'strata:actions',
      JSON.stringify(
        Array.from({ length: 12 }, (_, index) => ({
          actionId: 'menu:group',
          timestamp: now - (12 - index) * 1000,
        })),
      ),
    );
  });
}

test.describe('shortcut tip chip', () => {
  test('tip chip appears and can be dismissed', async ({ page }) => {
    await seedShortcutTip(page);
    await navigateToEditor(page);

    // The tip chip should appear in the status bar
    const tipChip = page.locator('.editor-status__tip-chip');
    await expect(tipChip).toBeVisible({ timeout: 5000 });

    // Dismiss the tip
    await page.locator('.editor-status__tip-dismiss').click();
    await expect(tipChip).toBeHidden({ timeout: 3000 });
  });

  test('tip chip click opens keyboard shortcuts palette', async ({ page }) => {
    await seedShortcutTip(page);
    await navigateToEditor(page);

    const tipChip = page.locator('.editor-status__tip-chip');
    await expect(tipChip).toBeVisible({ timeout: 5000 });

    // Click the tip body to open the palette
    await page.locator('.editor-status__tip-chip-body').click();

    // The shortcut palette dialog should open
    await expect(page.locator('.shortcut-palette')).toBeVisible({ timeout: 3000 });
  });
});
