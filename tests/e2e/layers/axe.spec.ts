import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Toolbar button's accessible name is "New" (icon + "New" text), not
  // "New file" — matching on the fuller phrase silently times out.
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });

  // A first-run "Welcome to Strata" modal can overlay the canvas.
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

/** Draw `count` distinct rectangles so the layers tree is populated. */
async function seedLayers(page: import('@playwright/test').Page, count: number) {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  for (let i = 0; i < count; i++) {
    const x1 = 100 + i * 120;
    const y1 = 100 + i * 60;
    await page.keyboard.press('r');
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x1 + 40, box.y + y1 + 40);
    await page.mouse.move(box.x + x1 + 80, box.y + y1 + 80);
    await page.mouse.up();
  }
  await page.getByRole('treeitem').first().waitFor({ timeout: 5000 });
}

test.describe('Layers Panel - axe-core scan', () => {
  test('layers panel has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);

    const results = await new AxeBuilder({ page })
      .include('.layers-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
