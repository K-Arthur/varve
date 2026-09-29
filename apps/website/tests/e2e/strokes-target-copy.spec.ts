import { expect, test } from '@playwright/test';

test('Strokes guidance stays readable across themes, widths, and deploy bases', async ({
  page,
  baseURL,
}, testInfo) => {
  expect(baseURL, 'website baseURL is configured for both deploy modes').toBeTruthy();
  const basePath = new URL(baseURL!).pathname.replace(/\/$/, '');
  const route = (path: string) => `${basePath}${path}`;
  const errors: string[] = [];
  const reportUnexpectedError = (message: string) => {
    // Static GitHub Pages cannot set response headers, so the shared layout's
    // CSP meta emits this Chromium warning about frame-ancestors. It is not a
    // page exception or a route failure; keep all other errors fatal.
    if (message.includes("The Content Security Policy directive 'frame-ancestors' is ignored")) {
      return;
    }
    errors.push(message);
  };
  page.on('pageerror', (error) => reportUnexpectedError(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') reportUnexpectedError(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(route('/features/strokes/'));
  await expect(page.getByRole('heading', { name: 'Stroke System', exact: true })).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /existing Design workspace/,
  );
  await expect(page.getByRole('heading', { name: 'Paint stays on its target' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Selection-to-flats' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clipped shading' })).toBeVisible();
  await expect(page.getByText(/never redirects a stroke to another layer/i)).toBeVisible();
  await expect(page.getByText(/sample one raster or the visible artwork/i)).toBeVisible();
  await expect(page.getByText(/Soft Shade limits one gesture to its opacity/i)).toBeVisible();
  const proofImage = page.getByRole('img', {
    name: 'Varve showing a red apple flat beneath editable black linework on a separate Flats layer',
  });
  await expect(proofImage).toBeVisible();
  await expect
    .poll(() => proofImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const clippedImage = page.getByRole('img', {
    name: 'Varve Design workspace with red shading clipped inside a blue painted shape on a separate Shading layer',
  });
  await expect(clippedImage).toBeVisible();
  await expect
    .poll(() => clippedImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  for (const theme of ['light', 'dark'] as const) {
    const control = page.locator('.desktop-theme-toggle').getByRole('radio', {
      name: `${theme === 'light' ? 'Light' : 'Dark'} theme`,
    });
    await control.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(control).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({
      path: testInfo.outputPath(`strokes-${theme}-desktop.png`),
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark'] as const) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    const mobileMenu = page.locator('.mobile-nav-dialog');
    await expect(mobileMenu).toBeVisible();
    const control = mobileMenu.locator('.mobile-theme-toggle').getByRole('radio', {
      name: `${theme === 'light' ? 'Light' : 'Dark'} theme`,
    });
    await control.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const width = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(width.content, `no horizontal overflow at 390px in ${theme} theme`).toBeLessThanOrEqual(
      width.viewport + 1,
    );
    await mobileMenu.getByRole('button', { name: 'Close menu' }).click();
    await page.screenshot({
      path: testInfo.outputPath(`strokes-${theme}-mobile.png`),
      fullPage: true,
    });
  }

  const guide = page.getByRole('link', { name: 'Read the stroke guide' });
  const guidePath = await guide.getAttribute('href');
  expect(guidePath).toBe(`${basePath}/docs/tools/strokes`);
  await expect(page.getByRole('link', { name: 'Read the Object Selection guide' })).toHaveAttribute(
    'href',
    `${basePath}/docs/tools/object-selection`,
  );
  await guide.click();
  await expect(page.getByRole('heading', { name: 'Strokes', exact: true })).toBeVisible();
  await expect(page.getByText(/creates a named Brush Layer/i)).toBeVisible();
  await expect(page.getByText(/Stroke-opacity mode caps one gesture/i)).toBeVisible();
  await expect(page.getByText(/Create clipped paint layer/i)).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(route('/docs/tools/object-selection/'));
  await expect(
    page.getByRole('heading', { name: 'Magic Wand for linework and flats' }),
  ).toBeVisible();
  await expect(page.getByText(/Create flats layer/i)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('selection-flats-guide-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const guideWidth = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(guideWidth.content, 'selection guide fits a narrow mobile viewport').toBeLessThanOrEqual(
    guideWidth.viewport + 1,
  );
  await page.screenshot({
    path: testInfo.outputPath('selection-flats-guide-mobile.png'),
    fullPage: true,
  });

  const guideImages = await page.locator('img').evaluateAll((nodes) =>
    nodes.map((image) => {
      const img = image as HTMLImageElement;
      return { alt: img.alt, loaded: img.complete && img.naturalWidth > 0 };
    }),
  );
  expect(guideImages.every((image) => image.alt.length > 0 && image.loaded)).toBe(true);

  await page.goto(route('/product/'));
  await expect(
    page.getByText(/Paint and clipped shading are also available from the Design toolbar/i),
  ).toBeVisible();
  const productStrokeLink = page.getByRole('link', {
    name: 'See the verified strokes, flats, and clipped-shading workflows',
  });
  await expect(productStrokeLink).toHaveAttribute('href', `${basePath}/features/strokes`);
  await page.screenshot({ path: testInfo.outputPath('product-dark-mobile.png'), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('product-dark-desktop.png'), fullPage: true });
  const productLightTheme = page.locator('.desktop-theme-toggle').getByRole('radio', {
    name: 'Light theme',
  });
  await productLightTheme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: testInfo.outputPath('product-light-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const productMobileWidth = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(productMobileWidth.content).toBeLessThanOrEqual(productMobileWidth.viewport + 1);
  await page.screenshot({ path: testInfo.outputPath('product-light-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
