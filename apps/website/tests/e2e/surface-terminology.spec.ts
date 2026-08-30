import { expect, test } from '@playwright/test';

/**
 * Product language is part of the surface contract. These checks prevent a
 * future copy pass from collapsing design canvases, frames, and publishing
 * pages back into one ambiguous word.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
});

test('product page distinguishes design canvases from publishing pages', async ({ page }) => {
  await page.goto('/product');
  const section = page.getByRole('region', { name: 'Design canvases and publishing pages' });
  await expect(section).toBeVisible();
  await expect(section).toContainText('design canvas');
  await expect(section).toContainText('Frames');
  await expect(section).toContainText('publishing page');
  await expect(section).toContainText('Figma');
});

test('interface documentation names the page controls by their publishing role', async ({
  page,
}) => {
  await page.goto('/docs/getting-started/interface');
  const section = page.getByRole('region', {
    name: 'Design canvases, frames, and publishing pages',
  });
  await expect(section).toBeVisible();
  await expect(section).toContainText('Pages panel');
  await expect(section).toContainText('Page Navigator');
  await expect(section).toContainText('same document and artwork remain intact');
});
