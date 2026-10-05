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
    await expect(page.getByText('No projects yet', { exact: true })).toBeVisible();
    const addBtn = page.getByRole('button', { name: 'New project' });
    await expect(addBtn).toBeVisible();
    await addBtn.hover();
    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
    await expect(tooltip).toContainText('New project');
  });

  test('the empty Projects state creates the first project', async ({ page }) => {
    await expect(page.getByText('No projects yet', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create your first project' }).click();

    const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Project name').fill('First project');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByRole('button', { name: 'First project', exact: true })).toBeVisible();
    await expect(page.getByText('No projects yet', { exact: true })).not.toBeVisible();
  });

  test('tooltip opens on keyboard focus and dismisses on Escape', async ({ page }) => {
    await expect(page.getByText('No projects yet', { exact: true })).toBeVisible();
    const addBtn = page.getByRole('button', { name: 'New project' });
    await expect(addBtn).toBeVisible();
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
