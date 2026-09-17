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
    page.getByRole('heading', { name: 'The useful control stays close to the work.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Context before clutter', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /See how the Inspector and context bar work together/ }),
  ).toHaveAttribute('href', /\/docs\/getting-started\/interface/);
  await expect(
    page.getByRole('link', { name: /Read the Precision Placement guide/ }),
  ).toHaveAttribute('href', /\/docs\/tools\/precision-placement/);

  const screenshotPath = testInfo.outputPath('precision-editing-feature.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('precision-editing-feature', { path: screenshotPath });
});

test('precision editing marketing page keeps the Inspector story usable at phone width', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/features/precision-editing?test-motion=static');

  await expect(
    page.getByRole('heading', { name: 'The useful control stays close to the work.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Context before clutter', exact: true }),
  ).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    cards: getComputedStyle(document.querySelector('.inspector-contract__grid')!)
      .gridTemplateColumns,
  }));
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.cards.trim().split(/\s+/)).toHaveLength(1);

  const screenshotPath = testInfo.outputPath('precision-editing-feature-mobile.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('precision-editing-feature-mobile', { path: screenshotPath });
});
