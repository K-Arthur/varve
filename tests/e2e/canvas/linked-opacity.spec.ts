/**
 * E2E: linked variable color modifiers — non-destructive relative alpha
 * (ADR-0016 workflow 2).
 */
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function createColorVariable(page: Page, name: string, hex: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add' }).first().click({ force: true });
  const nameField = page.locator('.variable-panel__add-input');
  await expect(nameField).toBeVisible({ timeout: 5000 });
  await nameField.fill(name);
  await page.locator('.variable-panel__add-value-input').fill(hex);
  await page.keyboard.press('Enter');
  await expect(nameField).toHaveCount(0, { timeout: 5000 });
}

async function bindFillToVariable(page: Page, variableName: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).first().click({ force: true });
  await page.getByRole('button', { name: 'Link fill to a variable' }).click();
  const bindMenu = page.locator('.binding-menu').first();
  await expect(bindMenu).toBeVisible({ timeout: 5000 });
  await bindMenu.locator('input[role="combobox"]').fill(variableName);
  await page.locator('.binding-menu__item').first().click();
}

test.describe('Linked color modifiers', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('variable creation and fill binding show the linked badge', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await createColorVariable(page, 'brand.teal', '#39d0c6');
    await bindFillToVariable(page, 'brand.teal');
    await expect(page.locator('.varve-binding-badge')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.varve-binding-badge')).toContainText(/brand\.teal/);
  });

  test('applying a ×50% modifier keeps the binding and shows the badge', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await createColorVariable(page, 'brand.teal', '#39d0c6');
    await bindFillToVariable(page, 'brand.teal');
    const badge = page.locator('.varve-binding-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    await badge.click();
    const popover = page.locator('.varve-modifier-popover');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(badge).toContainText(/50%/, { timeout: 5000 });
  });

  test('changing the variable value keeps the relative modifier', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await createColorVariable(page, 'brand.teal', '#39d0c6');
    await bindFillToVariable(page, 'brand.teal');
    const badge = page.locator('.varve-binding-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    await badge.click();
    await page.getByRole('button', { name: 'Apply' }).click();
    const valueField = page.locator('.variable-panel__value-btn').first();
    await valueField.click();
    const editInput = page.locator('.variable-panel__edit-input');
    await editInput.fill('#39d0c680');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toContainText(/50%/);
  });

  test('reset removes the modifier but keeps the binding', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await createColorVariable(page, 'brand.teal', '#39d0c6');
    await bindFillToVariable(page, 'brand.teal');
    const badge = page.locator('.varve-binding-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    await badge.click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await badge.click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).not.toContainText(/50%/);
  });
});
