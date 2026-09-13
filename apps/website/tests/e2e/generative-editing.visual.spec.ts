import { expect, test } from '@playwright/test';

async function preparePage(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((value: string) => {
    localStorage.setItem('varve-theme', value);
    localStorage.setItem('varve:website-analytics-consent', 'denied');
  }, theme);
}

test.describe('generative editing marketing pages', () => {
  test('feature page explains the available workflow', async ({ page }) => {
    await preparePage(page, 'light');
    await page.goto('/features/generative-editing?test-motion=static');
    await expect(page.getByRole('heading', { name: /make room in an image/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /one image workflow/i })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /promptless local expansion, before and after/i }),
    ).toBeVisible();
    const evidenceImages = page.locator('.before-after-grid img');
    await expect(evidenceImages).toHaveCount(2);
    await evidenceImages.first().scrollIntoViewIfNeeded();
    await evidenceImages.last().scrollIntoViewIfNeeded();
    await expect
      .poll(() => evidenceImages.evaluateAll((images) => images.map((image) => image.naturalWidth)))
      .toEqual([640, 640]);
    await expect(page.locator('.before-after-grid figcaption')).toHaveText([
      'Source photograph · 640px review copy',
      'Promptless Expand · LaMa, local CPU',
    ]);
    await expect(page).toHaveScreenshot('generative-editing-feature-light.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('feature page keeps the reviewed evidence usable on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preparePage(page, 'light');
    await page.goto('/features/generative-editing?test-motion=static');
    await expect(page.getByRole('heading', { name: /make room in an image/i })).toBeVisible();
    const evidenceImages = page.locator('.before-after-grid img');
    await expect(evidenceImages).toHaveCount(2);
    await evidenceImages.first().scrollIntoViewIfNeeded();
    await evidenceImages.last().scrollIntoViewIfNeeded();
    const layout = await page.locator('.before-after-grid').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        columns: style.gridTemplateColumns,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout.columns.split(' ').length).toBe(1);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    await expect(page).toHaveScreenshot('generative-editing-feature-mobile-light.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('docs page exposes masks, controls, and synchronization behavior', async ({ page }) => {
    await preparePage(page, 'dark');
    await page.goto('/docs/tools/generative-editing?test-motion=static');
    await expect(
      page.getByRole('heading', { name: 'Generative Editing', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /build and refine the mask/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /review and accept/i })).toBeVisible();
    await expect(page).toHaveScreenshot('generative-editing-docs-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
