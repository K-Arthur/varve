import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('shortcut tip chip', () => {
  test('tip chip appears and can be dismissed', async ({ page }) => {
    await navigateToEditor(page);

    // Inject action records via the ActionTracker singleton
    await page.evaluate(() => {
      const tracker = (window as any).__actionTracker;
      if (!tracker) return;

      // Simulate 12 menu:group uses without the shortcut
      for (let i = 0; i < 12; i++) {
        tracker.record('menu:group', undefined);
      }
    });

    // Wait for the poll interval — for test purposes we trigger it manually
    await page.evaluate(() => {
      // Force a re-check by triggering the poll
      const ev = new CustomEvent('varve:force-tip-poll');
      window.dispatchEvent(ev);
    });

    // The tip chip should appear in the status bar
    const tipChip = page.locator('.editor-status__tip-chip');
    await expect(tipChip).toBeVisible({ timeout: 5000 });

    // Dismiss the tip
    await page.locator('.editor-status__tip-dismiss').click();
    await expect(tipChip).toBeHidden({ timeout: 3000 });
  });

  test('tip chip click opens keyboard shortcuts palette', async ({ page }) => {
    await navigateToEditor(page);

    await page.evaluate(() => {
      const tracker = (window as any).__actionTracker;
      if (!tracker) return;
      for (let i = 0; i < 12; i++) {
        tracker.record('menu:group', undefined);
      }
    });

    const tipChip = page.locator('.editor-status__tip-chip');
    await expect(tipChip).toBeVisible({ timeout: 5000 });

    // Click the tip body to open the palette
    await page.locator('.editor-status__tip-chip-body').click();

    // The shortcut palette dialog should open
    await expect(page.locator('.shortcut-palette')).toBeVisible({ timeout: 3000 });
  });
});
