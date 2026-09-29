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
  await expect(page.getByRole('heading', { name: 'Paint stays on its target' })).toBeVisible();
  await expect(page.getByText(/never redirects a stroke to another layer/i)).toBeVisible();

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
  await guide.click();
  await expect(page.getByRole('heading', { name: 'Strokes', exact: true })).toBeVisible();
  await expect(page.getByText(/creates a named Brush Layer/i)).toBeVisible();
  expect(errors).toEqual([]);

  const images = await page.locator('img').evaluateAll((nodes) =>
    nodes.map((image) => {
      const img = image as HTMLImageElement;
      return { alt: img.alt, loaded: img.complete && img.naturalWidth > 0 };
    }),
  );
  expect(images.every((image) => image.alt.length > 0 && image.loaded)).toBe(true);
});
