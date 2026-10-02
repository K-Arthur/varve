import { expect, test } from '@playwright/test';

test.describe('Home Shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.varve-home');
  });

  test('renders HomeShell with toolbar', async ({ page }) => {
    await expect(page.locator('.varve-home__toolbar')).toBeVisible();
    await expect(page.getByRole('button', { name: /^new$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /open/i })).toBeVisible();
  });

  test('sidebar nav renders with Recent, All Files, and Trash', async ({ page }) => {
    const sidebar = page.locator('nav[aria-label="File navigation"]');
    await expect(sidebar).toBeVisible();

    const items = sidebar.getByRole('button');
    const labels = await items.evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ''));

    expect(labels.some((l) => l.startsWith('Recent'))).toBe(true);
    expect(labels.some((l) => l.startsWith('All Files'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Trash'))).toBe(true);
  });

  test('sidebar nav items can be clicked to switch sections', async ({ page }) => {
    const trashItem = page
      .locator('nav[aria-label="File navigation"]')
      .getByRole('button', { name: /trash/i });
    await trashItem.click();
    await page.waitForTimeout(200);

    const emptyState = page.locator('.varve-empty');
    await expect(emptyState).toBeVisible();
    await expect(emptyState.locator('.varve-empty__headline')).toContainText(/trash/i);
  });

  test('empty state shows correct headline for recent section', async ({ page }) => {
    const emptyState = page.locator('.varve-empty[role="status"]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState.locator('.varve-empty__headline')).toContainText(/nothing here yet/i);
  });

  test('home toolbar and content use the full width on narrow viewports', async ({ page }) => {
    for (const width of [320, 375, 600, 754, 768]) {
      await page.setViewportSize({ width, height: 885 });

      const layout = await page.evaluate(() => {
        const toolbar = document.querySelector<HTMLElement>('.varve-home__toolbar');
        const content = document.querySelector<HTMLElement>('.varve-home__content');
        const shell = document.querySelector<HTMLElement>('.varve-home');
        if (!toolbar || !content || !shell) throw new Error('Home shell is missing');
        return {
          documentWidth: document.documentElement.scrollWidth,
          shell: shell.getBoundingClientRect().toJSON(),
          toolbar: toolbar.getBoundingClientRect().toJSON(),
          content: content.getBoundingClientRect().toJSON(),
        };
      });

      expect(layout.documentWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(width);
      expect(layout.shell.x, `shell offset at ${width}px`).toBe(0);
      expect(layout.toolbar.x, `toolbar offset at ${width}px`).toBe(0);
      expect(layout.toolbar.width, `toolbar width at ${width}px`).toBe(width);
      expect(layout.content.x, `content offset at ${width}px`).toBe(0);
      expect(layout.content.width, `content width at ${width}px`).toBe(width);
      const compactLabels = await page
        .locator('.varve-home__toolbar-label')
        .evaluateAll((labels) => labels.map((label) => getComputedStyle(label).display === 'none'));
      expect(
        compactLabels.every((isHidden) => isHidden),
        `toolbar labels at ${width}px`,
      ).toBe(width <= 480);
      await expect(page.getByRole('button', { name: 'Workspace filter' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
      if (width === 320 || width === 754) {
        await page.screenshot({
          path: test.info().outputPath(`home-responsive-${width}.png`),
          fullPage: true,
        });
      }
    }
  });

  test('compact home controls retain filter and view interactions', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 885 });
    const workspaceFilter = page.getByRole('button', { name: 'Workspace filter' });
    await workspaceFilter.click();
    const workspaceOptions = page.getByRole('listbox', { name: 'Workspace filter' });
    await expect(workspaceOptions).toBeVisible();
    await workspaceOptions.getByRole('option', { name: 'Pinned Only' }).click();
    await expect(workspaceOptions).toBeHidden();
    await expect(workspaceFilter).toHaveAttribute('title', 'Workspace filter: Pinned Only');

    const filters = page.getByRole('button', { name: /^Filters/ });
    await filters.click();
    const filterDialog = page.getByRole('dialog', { name: 'Filters', exact: true });
    await expect(filterDialog).toBeVisible();
    await filterDialog.getByRole('checkbox', { name: 'Varve', exact: true }).check();
    await page.keyboard.press('Escape');
    await expect(filterDialog).toBeHidden();
    await expect(filters).toHaveAccessibleName('Filters (1 active)');

    const viewMode = page.getByRole('radiogroup', { name: 'View mode' });
    await viewMode.getByRole('radio', { name: 'List', exact: true }).check();
    await expect(viewMode.getByRole('radio', { name: 'List', exact: true })).toBeChecked();
    await viewMode.getByRole('radio', { name: 'Grid', exact: true }).check();
    await expect(viewMode.getByRole('radio', { name: 'Grid', exact: true })).toBeChecked();
  });
});
