import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
});

test('precision placement documentation exposes the implemented contracts', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/docs/tools/precision-placement?test-motion=static');

  await expect(
    page.getByRole('heading', { name: 'Precision placement', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Exact nudging', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scoped snapping', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Alignment and distribution', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /Fixed gap/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    /\/docs\/settings/,
  );

  const screenshotPath = testInfo.outputPath('precision-placement-docs.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('precision-placement-docs', { path: screenshotPath });
});

test('precision editing marketing page explains the workflow and links to docs', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/features/precision-editing?test-motion=static');

  await expect(
    page.getByRole('heading', {
      name: 'Place things precisely without fighting the canvas.',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Intent → resolve → explain.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Small controls with dependable consequences.',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Read the Precision Placement guide/ }),
  ).toHaveAttribute('href', /\/docs\/tools\/precision-placement/);

  const screenshotPath = testInfo.outputPath('precision-editing-feature.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('precision-editing-feature', { path: screenshotPath });
});
