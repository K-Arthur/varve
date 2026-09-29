import { expect, test } from '@playwright/test';

test('enhancement claims and responsive help work on both deployment base paths', async ({
  page,
  baseURL,
}, testInfo) => {
  expect(baseURL, 'each website project supplies its deployment base').toBeTruthy();
  const basePath = new URL(baseURL!).pathname.replace(/\/$/, '');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/features/image-enhancement?test-motion=static');
  await expect(
    page.getByRole('heading', { name: 'A model is ready only after its files are checked.' }),
  ).toBeVisible();
  await expect(
    page.getByText(/download space and inference memory are different costs/i),
  ).toBeVisible();
  await expect(page.getByText(/reopening that document does not need the model/i)).toBeVisible();
  const helpLink = page.getByRole('link', { name: 'Read the model and memory guide' });
  const helpPath = new URL((await helpLink.getAttribute('href'))!, page.url()).pathname;
  expect(helpPath).toBe(`${basePath}/docs/tools/image-enhancement`);
  await expect(page.locator('.model-install-grid')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-enhancement-desktop.png`),
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-enhancement-mobile.png`),
    fullPage: true,
    animations: 'disabled',
  });
  await page.locator('.model-install').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-model-install-mobile.png`),
    fullPage: false,
    animations: 'disabled',
  });

  await helpLink.click();
  await expect(page).toHaveURL(new RegExp(`${basePath}/docs/tools/image-enhancement$`));
  await expect(page.getByRole('heading', { name: 'Models and memory' })).toBeVisible();
  await expect(
    page.getByText(/Cancellation remains in progress until the reader has stopped/i),
  ).toBeVisible();

  await page.goto('/docs/performance?test-motion=static');
  await expect(
    page.getByRole('heading', { name: 'Chromebook routes have different limits' }),
  ).toBeVisible();
  await expect(page.getByText(/physical Duet touch\/pen/i)).toBeVisible();
  const chromebookLink = page.getByRole('link', { name: 'Chromebook route guide' });
  expect(new URL((await chromebookLink.getAttribute('href'))!, page.url()).pathname).toBe(
    `${basePath}/docs/chromebook`,
  );
});
