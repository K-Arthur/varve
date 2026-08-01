import { expect, test } from '@playwright/test';
import { navigateToHome } from '../shared';

test.describe('Home tooltip system', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHome(page);
  });

  test('hovering the sort toggle shows a Tooltip with the current sort state', async ({ page }) => {
    const sortBtn = page.getByRole('button', { name: /^sort (ascending|descending)$/i });
    await expect(sortBtn).toBeVisible({ timeout: 10000 });

    const before = (await sortBtn.getAttribute('aria-label')) ?? '';
    await sortBtn.hover();

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
    await expect(tooltip).toContainText(before);
  });

  test('hovering the sidebar new-project button shows a Tooltip', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: 'New project' });
    if (!(await addBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await addBtn.hover();
    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
    await expect(tooltip).toContainText('New project');
  });

  test('tooltip opens on keyboard focus and dismisses on Escape', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: 'New project' });
    if (!(await addBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await addBtn.focus();
    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
    await page.keyboard.press('Escape');
    await expect(tooltip).not.toBeVisible({ timeout: 1000 });
  });

  test('tooltip trigger carries aria-describedby to the tooltip id', async ({ page }) => {
    const sortBtn = page.getByRole('button', { name: /^sort (ascending|descending)$/i });
    await expect(sortBtn).toBeVisible({ timeout: 10000 });
    await sortBtn.hover();

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
    const tooltipId = await tooltip.getAttribute('id');
    expect(tooltipId).toBeTruthy();
    await expect(sortBtn).toHaveAttribute('aria-describedby', tooltipId ?? '');
  });
});
