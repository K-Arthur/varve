import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

test.describe.configure({ mode: 'serial' });

test.describe('Menubar visual integrity', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToEditor(page);
  });

  test('hover-switching to View starts at the top and selected rows retain contrast', async ({
    page,
  }) => {
    await openMenu(page, 'Object');
    await page.getByRole('menubar').getByRole('menuitem', { name: 'View' }).hover();
    const menuLayer = page.locator('.editor-menubar__menu');
    const menu = menuLayer.getByRole('menu', { name: 'View' });
    const activeWorkspace = menu.getByRole('menuitemradio', { name: 'Workspace: Design' });

    await expect(activeWorkspace).toHaveAttribute('aria-checked', 'true');
    await expect(activeWorkspace).toBeEnabled();

    const geometry = await menuLayer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        right: rect.right,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
    });
    expect(geometry.bottom).toBeLessThanOrEqual(1080);
    expect(geometry.right).toBeLessThanOrEqual(1920);
    expect(geometry.scrollTop).toBe(0);

    const results = await new AxeBuilder({ page })
      .include('.editor-menubar__menu')
      .withRules(['color-contrast'])
      .analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('Object menu exposes its final command without clipping', async ({ page }) => {
    await openMenu(page, 'Object');
    const menuLayer = page.locator('.editor-menubar__menu');
    const menu = menuLayer.getByRole('menu', { name: 'Object' });

    await expect(menu.getByRole('menuitem', { name: 'Detect Duplicates' })).toBeVisible();
    const geometry = await menuLayer.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      bottom: element.getBoundingClientRect().bottom,
    }));
    expect(geometry.bottom).toBeLessThanOrEqual(1080);
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  });

  for (const theme of ['light', 'dark', 'high-contrast'] as const) {
    test(`active menu rows pass contrast checks in the ${theme} theme`, async ({ page }) => {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      await openMenu(page, 'View');

      const results = await new AxeBuilder({ page })
        .include('.editor-menubar__menu')
        .withRules(['color-contrast'])
        .analyze();
      expect(results.violations).toHaveLength(0);
    });
  }
});
