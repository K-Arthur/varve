import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('responsive panel drawers', () => {
  test('closes each drawer with Escape and restores focus to its trigger', async ({ page }) => {
    await navigateToEditor(page);
    await page.setViewportSize({ width: 640, height: 700 });

    const cases = [
      {
        button: page.locator('.editor__fab--layers'),
        panel: page.locator('.editor__layers-panel'),
      },
      {
        button: page.locator('.editor__fab--inspector'),
        panel: page.locator('.editor__inspector-panel'),
      },
      {
        button: page.locator('.editor__fab--library'),
        panel: page.locator('.editor__library-panel'),
      },
    ];

    for (const { button, panel } of cases) {
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(panel).toHaveAttribute('data-visible', 'true');

      await page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toBeFocused();
      if ((await panel.count()) > 0) {
        await expect(panel).not.toHaveAttribute('data-visible');
      }
    }
  });
});
