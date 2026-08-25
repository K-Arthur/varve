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

    const finalCommand = menu.getByRole('menuitem', { name: 'Detect Duplicates' });
    // Long menus are intentionally viewport-constrained by FloatingPortal;
    // verify the final command is reachable in that scroll surface instead
    // of requiring the whole command list to fit above the fold.
    await finalCommand.scrollIntoViewIfNeeded();
    await expect(finalCommand).toBeVisible();
    const geometry = await menuLayer.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      bottom: element.getBoundingClientRect().bottom,
      scrollTop: element.scrollTop,
    }));
    expect(geometry.bottom).toBeLessThanOrEqual(1080);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(geometry.scrollTop).toBeGreaterThan(0);
    const finalRect = await finalCommand.evaluate((element) => element.getBoundingClientRect());
    expect(finalRect.bottom).toBeLessThanOrEqual(1080);
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
