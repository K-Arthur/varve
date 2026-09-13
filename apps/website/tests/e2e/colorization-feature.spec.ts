import { expect, test } from '@playwright/test';

test.describe('colorization marketing and documentation', () => {
  test('exposes the supported workflows and honest photo-model boundary', async ({
    page,
  }, testInfo) => {
    await page.goto('/features/colorization');

    await expect(
      page.getByRole('heading', { name: 'Put color back under your control.' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tint / recolor' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Palette colorize' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reference transfer' })).toBeVisible();
    await expect(page.locator('.photo-note__status span[aria-hidden="true"]')).toHaveText(
      'Photo AI: model-gated',
    );
    await expect(page.getByText(/no source image is uploaded as a fallback/i)).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Read the Colorize workflow guide/i }),
    ).toHaveAttribute('href', /\/docs\/tools\/colorization$/);
    await page.screenshot({
      path: testInfo.outputPath('colorization-feature.png'),
      fullPage: true,
    });
  });

  test('keeps the workflow cards readable on a narrow viewport', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/features/colorization');

    const cards = page.locator('.workflow-card');
    await expect(cards).toHaveCount(3);
    const layout = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, top: rect.top, right: rect.right };
      }),
    );
    expect(layout.every((rect) => rect.width > 300 && rect.right <= 390)).toBe(true);
    expect(layout[1]!.top).toBeGreaterThan(layout[0]!.top);
    await page.screenshot({
      path: testInfo.outputPath('colorization-feature-mobile.png'),
      fullPage: true,
    });
  });

  test('links the docs index and color reference to the detailed guide', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByRole('link', { name: 'Colorize & Recolor' })).toHaveAttribute(
      'href',
      /\/docs\/tools\/colorization$/,
    );

    await page.goto('/docs/tools/colorization');
    await expect(
      page.getByRole('heading', { name: 'Colorize with an explicit source and scope.' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review, save, and export' })).toBeVisible();
    await expect(page.getByText(/materialized and source-preserving/i)).toBeVisible();
  });
});
