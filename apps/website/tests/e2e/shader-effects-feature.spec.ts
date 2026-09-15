import { expect, test } from '@playwright/test';

test.describe('shader effects marketing workflow', () => {
  test('feature page explains the editable workflow and links to the guide', async ({
    page,
  }, testInfo) => {
    await page.goto('/features/shader-effects', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Give pixels a point of view',
    );
    await expect(
      page.getByRole('heading', { name: 'Acceleration is optional. The result is not.' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read the Shader Effects guide' })).toHaveAttribute(
      'href',
      /\/docs\/tools\/shader-effects$/,
    );
    await page.screenshot({
      path: testInfo.outputPath('shader-effects-feature.png'),
      fullPage: true,
    });
  });

  test('docs page exposes persistence, fallback, and export boundaries', async ({
    page,
  }, testInfo) => {
    await page.goto('/docs/tools/shader-effects', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shader Effects');
    await expect(page.getByRole('heading', { name: 'What is stored' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backend and fallback' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Why not arbitrary shader imports?' }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('shader-effects-docs.png'), fullPage: true });
  });
});
