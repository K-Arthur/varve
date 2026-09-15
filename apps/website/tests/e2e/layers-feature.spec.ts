import { expect, test } from '@playwright/test';

test('Layers feature page communicates the supported handoff and stays within the viewport', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.localStorage.setItem('varve-theme', 'light');
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
  await page.goto('/features/layers');

  await expect(
    page.getByRole('heading', { name: 'Move ideas without losing the structure.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Place a selection without flattening it.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Read the Layers navigation contract/ }),
  ).toHaveAttribute('href', /layers-navigation\.md$/);
  const arrangement = page.getByTestId('layers-arrangement-contract');
  await expect(arrangement).toBeVisible();
  await expect(arrangement).toContainText('Space objects and stack layers as different operations');
  await expect(arrangement.locator('article')).toHaveCount(3);
  const visualContract = page.getByTestId('layers-visual-contract');
  await expect(visualContract).toBeVisible();
  await expect(visualContract).toContainText('Read the stack before you touch it');
  await expect(page.locator('.layer-demo__toolbar')).toContainText('Filter layers');
  const fidelity = page.getByTestId('layers-fidelity-contract');
  await expect(fidelity).toBeVisible();
  await expect(fidelity).toContainText('Keep the editable source. Know what travels.');
  await expect(fidelity.getByRole('heading', { name: 'Native documents' })).toBeVisible();
  await expect(fidelity.getByRole('heading', { name: 'Portable appearance' })).toBeVisible();
  await expect(fidelity.getByRole('heading', { name: 'Honest interchange' })).toBeVisible();

  const bounds = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    overflow: getComputedStyle(document.documentElement).overflowX,
  }));
  expect(
    bounds.documentWidth,
    'marketing page must not introduce horizontal overflow',
  ).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.overflow).not.toBe('hidden');

  await page.screenshot({
    path: testInfo.outputPath('layers-feature-light.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
