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

      const shortcutRows = await emptyState
        .locator('.editor-canvas__empty-state-shortcut')
        .evaluateAll((elements) =>
          elements.map((element) => Math.round(element.getBoundingClientRect().top)),
        );
      expect(shortcutRows).toHaveLength(4);
      const rowCounts = [...new Set(shortcutRows)]
        .map((top) => shortcutRows.filter((item) => item === top).length)
        .sort();
      expect(rowCounts).toEqual([2, 2]);

      await expect(emptyState).toHaveScreenshot(`canvas-empty-guidance-${theme}.png`, {
        animations: 'disabled',
        maxDiffPixels: 16,
      });

      await page.setViewportSize({ width: 560, height: 600 });
      await expect(emptyState).toBeVisible();
      const narrowWidth = await emptyState.evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      expect(narrowWidth).toBeLessThan(560);
      const shortcutsFit = await emptyState.evaluate((element) => {
        const shortcuts = element.querySelector('.editor-canvas__empty-state-shortcuts');
        return shortcuts ? shortcuts.scrollWidth <= shortcuts.clientWidth + 1 : false;
      });
      expect(shortcutsFit).toBe(true);
    });
  }
});
