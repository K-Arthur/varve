/**
 * Selection Colors inspection, interaction, and visual regression coverage.
 *
 * This drives the real canvas and Properties panel so a component test cannot
 * hide a layout, focus, or disclosure-state regression.
 */
import { expect, type Page, test } from '@playwright/test';
import { selectFillType } from '../helpers/editor-helpers';
import { navigateToCleanEditor } from '../helpers/nav';

async function createAndSelectTwoRects(page: Page): Promise<void> {
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

  await page.keyboard.press('r');
  await page.mouse.move(box.x + 470, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 280);
  await page.mouse.up();
  await page.waitForTimeout(300);

  await page.keyboard.press('v');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByRole('treeitem')).toHaveCount(2);
}

async function expandSelectionColors(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Selection Colors', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
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
    await createAndSelectTwoRects(page);
    await expandSelectionColors(page);

    const colors = colorsSection(page);
    await expect(colors).toBeVisible();
    await expect(colors).toContainText('2 uses');
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

  test('keeps the compact panel legible across themes', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createAndSelectTwoRects(page);
    await expandSelectionColors(page);

    const colors = colorsSection(page);
    const section = page.locator('section.insp-disclosure', { has: colors });
    await expect(colors).toBeVisible();

    await setTheme(page, 'light');
    await expect(section).toHaveScreenshot('selection-colors-light.png', { maxDiffPixels: 80 });
    await setTheme(page, 'dark');
    await expect(section).toHaveScreenshot('selection-colors-dark.png', { maxDiffPixels: 80 });
  });

  test('excludes image pixels from selected paint colors', async ({ page }) => {
    await navigateToCleanEditor(page);
    await createAndSelectTwoRects(page);
    await expandSelectionColors(page);

    const colors = colorsSection(page);
    await expect(colors).toBeVisible();

    await selectFillType(page, 'Image');
    await expect(colors).toContainText('2 image fills — not sampled as editable vector colors.');
    await expect(colors.getByRole('button', { name: /paint use/i })).toHaveCount(0);
  });
});
