/**
 * E2E: table appearance variable binding + alpha modifier review.
 *
 * Inserts a table, creates a color variable, links the header fill to it,
 * applies an alpha modifier, and captures screenshots for manual review.
 */
import { expect, test } from '@playwright/test';
import { activateTableTool, addColorVariable, dragOnCanvas, navigateToEditor } from '../shared';

test('table appearance variable binding with modifier', async ({ page }) => {
  await navigateToEditor(page);

  // Insert a table
  await activateTableTool(page);
  await dragOnCanvas(page, 200, 160, 700, 460);
  await page.waitForTimeout(400);

  // Create a color variable via the Variables panel
  await addColorVariable(page, 'Brand Teal', '#39d0c6');
  await expect(page.getByText('Brand Teal')).toBeVisible({ timeout: 5000 });

  // Select the table via the layers panel so the inspector shows it
  await page.getByRole('treeitem').first().click({ timeout: 5000 });
  await page.waitForTimeout(300);

  // Screenshot: table selected, appearance section visible
  await page.screenshot({
    path: 'test-results/visual/review-10-table-selected.png',
    fullPage: false,
  });

  // Link header fill to the variable
  const linkBtn = page.getByRole('button', { name: /link header fill to a variable/i });
  await linkBtn.click({ timeout: 5000 });
  await page.waitForTimeout(300);
  const menu = page.getByRole('combobox', { name: /search variables/i });
  await menu.click({ timeout: 5000 });
  await page.getByRole('option', { name: /Brand Teal/ }).click({ timeout: 5000 });

  // The badge should appear with the variable name
  await expect(page.getByText('$Brand Teal', { exact: false }).first()).toBeVisible({
    timeout: 5000,
  });

  // Screenshot: header fill linked
  await page.screenshot({
    path: 'test-results/visual/review-11-header-linked.png',
    fullPage: false,
  });

  // Open the modifier popover and set multiply x50%
  await page.getByText('$Brand Teal', { exact: false }).first().click({ timeout: 5000 });
  await expect(page.getByRole('dialog', { name: 'Alpha modifier' })).toBeVisible({
    timeout: 5000,
  });

  await page.screenshot({
    path: 'test-results/visual/review-12-modifier-popover.png',
    fullPage: false,
  });

  // Apply the default multiply 50% modifier
  await page.getByRole('button', { name: 'Apply' }).click({ timeout: 5000 });

  // Badge should show the multiplier label
  await expect(page.getByText('× 50%', { exact: false }).first()).toBeVisible({
    timeout: 5000,
  });

  await page.screenshot({
    path: 'test-results/visual/review-13-header-modified.png',
    fullPage: false,
  });
});
