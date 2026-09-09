import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const THEMES = ['light', 'dark', 'high-contrast'] as const;

test.describe('CanvasArea empty-surface guidance', () => {
  for (const theme of THEMES) {
    test(`${theme} theme keeps guidance scoped and legible`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await navigateToEditor(page);
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);

      const canvas = page.locator('.editor-canvas');
      const emptyState = canvas.locator('.editor-canvas__empty-state');
      await expect(emptyState).toBeVisible();
      await expect(emptyState).toHaveAttribute('role', 'status');

      const geometry = await emptyState.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          canvasWidth: element.closest('.editor-canvas')?.getBoundingClientRect().width ?? 0,
          width: rect.width,
          pointerEvents: style.pointerEvents,
        };
      });
      expect(geometry.width).toBeLessThan(geometry.canvasWidth);
      expect(geometry.pointerEvents).toBe('none');

      await expect(emptyState).toHaveScreenshot(`canvas-empty-guidance-${theme}.png`, {
        animations: 'disabled',
      });

      await page.setViewportSize({ width: 560, height: 600 });
      await expect(emptyState).toBeVisible();
      const narrowWidth = await emptyState.evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      expect(narrowWidth).toBeLessThan(560);
    });
  }
});
