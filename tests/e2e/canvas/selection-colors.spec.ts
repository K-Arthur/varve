/**
 * Selection Colors inspection, interaction, and visual regression coverage.
 *
 * This drives the real canvas and Properties panel so a component test cannot
 * hide a layout, focus, or disclosure-state regression.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

async function createAndSelectRect(page: Page): Promise<void> {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas was not available for the selection-colors fixture.');

  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 430, box.y + 330);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 290, box.y + 240);
  await page.waitForTimeout(400);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    localStorage.setItem('varve-theme', value);
    document.documentElement.dataset.theme = value;
  }, theme);
  await page.waitForTimeout(150);
}

function colorsSection(page: Page) {
  return page.getByTestId('selection-colors');
}

test.describe('Selection Colors inspector', () => {
  test('opens the selected paint picker from keyboard focus', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createAndSelectRect(page);

    const colors = colorsSection(page);
    await expect(colors).toBeVisible();
    await expect(colors).toContainText('1');
    await expect(colors).not.toContainText('\u00d7');
    const swatch = colors.getByRole('button', { name: /paint use/i });
    await expect(swatch).toHaveCount(1);
    await swatch.focus();
    await page.keyboard.press('Enter');
    const picker = page.getByRole('dialog', { name: /pick rgb/i });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: /^done$/i }).click();
    await expect(colors.getByRole('button', { name: /rgb #39d0c6/i })).toBeVisible();
  });

  test('keeps the compact panel legible across themes and excludes image pixels', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createAndSelectRect(page);

    const colors = colorsSection(page);
    const section = page.locator('section.insp-disclosure', { has: colors });
    await expect(colors).toBeVisible();

    await setTheme(page, 'light');
    await expect(section).toHaveScreenshot('selection-colors-light.png', { maxDiffPixels: 80 });
    await setTheme(page, 'dark');
    await expect(section).toHaveScreenshot('selection-colors-dark.png', { maxDiffPixels: 80 });

    await page
      .getByRole('combobox', { name: /fill type/i })
      .first()
      .click();
    await page.getByRole('option', { name: /^image$/i }).click();
    await expect(colors).toContainText('1 image fill — not sampled as editable vector colors.');
    await expect(colors.getByRole('button', { name: /paint use/i })).toHaveCount(0);
  });
});
