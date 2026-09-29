import { expect, test } from '@playwright/test';
import { contrastRatio, effectiveBackground, parseColor } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
});

test('desktop and mobile use the same ordered destinations with bounded exact-page semantics', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/support/troubleshooting');

  const desktop = page.locator('#site-nav-links');
  await expect(desktop.getByRole('link')).toHaveText(['Product', 'Features', 'Docs']);
  const activePages = page.locator('.nav-popover a[aria-current="page"]');
  await expect(activePages).toHaveCount(1);
  await expect(activePages.locator('.nav-popover-label')).toHaveText('Troubleshooting');
  await expect(page.locator('.nav-disclosure-summary[aria-current]')).toHaveCount(0);
  await expect(page.locator('[data-nav-details]').nth(1).locator('summary')).toHaveClass(
    /nav-section-current/,
  );

  await page.goto('/features/code');
  const featuresSection = desktop.getByRole('link', { name: 'Features', exact: true });
  await expect(featuresSection).toHaveClass(/nav-section-current/);
  await expect(featuresSection).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#site-nav-links > li > a[aria-current="page"]')).toHaveCount(0);

  await page.goto('/learn/tutorials');
  await page.locator('.nav-disclosure-summary').filter({ hasText: 'Learn' }).click();
  await page.locator('#learn-menu').getByRole('link', { name: 'Tutorials' }).waitFor();
  await expect(page.locator('.nav-disclosure-summary[aria-current]')).toHaveCount(0);
  await expect(page.locator('.nav-disclosure-summary').filter({ hasText: 'Learn' })).toHaveClass(
    /nav-section-current/,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const desktopDestinations = await page
    .locator('#site-nav-links a[href]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href')));
  await page.locator('.mobile-menu-toggle').click();
  const mobile = page.locator('.mobile-nav-dialog');
  const mobileLinks = mobile.getByRole('navigation', { name: 'Main menu' }).getByRole('link');
  await expect(mobileLinks).toHaveText([
    'Product',
    'Features',
    'Docs',
    'Learning hub',
    'Tutorials',
    'Examples',
    'Community',
    'Support home',
    'FAQ',
    'Troubleshooting',
    'Known issues',
    'Report an issue',
    'Contact',
  ]);
  expect(
    await mobileLinks.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href')),
    ),
  ).toEqual(desktopDestinations);
  await expect(mobile.locator('a[aria-current="page"]')).toHaveCount(0);
  await expect(page.locator('.site-footer a[href$="/contribute"]').first()).toBeAttached();
});

test('desktop disclosure opens by keyboard, closes on Escape, focus exit, and outside click', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const learn = page.locator('#learn-menu');
  const summary = page.locator('.nav-disclosure-summary').filter({ hasText: 'Learn' });

  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(learn).toBeVisible();
  await learn.getByRole('link').first().focus();
  await page.keyboard.press('Escape');
  await expect(learn).toBeHidden();
  await expect(summary).toBeFocused();

  await summary.click();
  await page.locator('.site-logo').focus();
  await expect(learn).toBeHidden();
  await summary.click();
  await page.locator('main').click({ position: { x: 12, y: 12 } });
  await expect(learn).toBeHidden();
});

test('mobile menu opened after scrolling fills the viewport, scrolls inside, and restores page state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 800);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    document.addEventListener(
      'click',
      (event) => {
        if ((event.target as Element | null)?.closest('.mobile-menu-toggle')) {
          (window as Window & { __menuScrollAtClick?: number }).__menuScrollAtClick =
            window.scrollY;
        }
      },
      true,
    );
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const pageScroll = await page.evaluate(() => window.scrollY);
  expect(pageScroll).toBeGreaterThan(100);
  const previousOverflow = await page
    .locator('body')
    .evaluate((body) => getComputedStyle(body).overflow);

  const toggle = page.locator('.mobile-menu-toggle');
  await toggle.focus({ preventScroll: true });
  await page.keyboard.press('Enter');
  const scrollAtOpen = await page.evaluate(
    () => (window as Window & { __menuScrollAtClick?: number }).__menuScrollAtClick,
  );
  expect(scrollAtOpen).toBeGreaterThan(100);
  const dialog = page.locator('.mobile-nav-dialog');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog).toHaveAccessibleName('Site navigation');
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).toMatchObject({ x: 0, y: 0, width: 390, height: 620 });
  await expect(dialog.getByRole('link', { name: 'Known issues' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Report an issue' })).toBeVisible();

  await dialog.getByRole('link', { name: 'Contact' }).scrollIntoViewIfNeeded();
  const innerScroll = await page.locator('.mobile-nav-scroll').evaluate((node) => node.scrollTop);
  expect(innerScroll).toBeGreaterThan(0);
  await expect(page.locator('body')).toHaveCSS('position', 'fixed');
  expect(await page.locator('body').evaluate((body) => body.style.top)).toBe(`-${scrollAtOpen}px`);
  expect(await page.locator('body').evaluate((body) => getComputedStyle(body).overflow)).toBe(
    'hidden',
  );

  await page.locator('.mobile-menu-close').click();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(toggle).toBeFocused();
  expect(await page.locator('body').evaluate((body) => getComputedStyle(body).overflow)).toBe(
    previousOverflow,
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollAtOpen);
});

test('native mobile dialog contains keyboard focus and returns it on dismissal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const toggle = page.locator('.mobile-menu-toggle');
  await toggle.click();
  const dialog = page.locator('.mobile-nav-dialog');
  await expect(dialog).toHaveAccessibleName('Site navigation');
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[data-mobile-nav-dialog]')),
      ),
      `Tab ${index + 1} should remain inside the modal`,
    ).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest('[data-mobile-nav-dialog]'))),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(toggle).toBeFocused();
});

test('search from the mobile sheet hands off focus to search, then returns to the menu control', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const toggle = page.locator('.mobile-menu-toggle');
  await toggle.click();
  await page.locator('.mobile-nav-search').click();
  await expect(page.locator('.mobile-nav-dialog')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-search-dialog]')).toHaveAttribute('open', '');
  await expect(page.locator('[data-search-input]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-search-dialog]')).not.toHaveAttribute('open', '');
  await expect(toggle).toBeFocused();
});

test('download and browser demo use the site base and preserve the new-tab announcement', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const download = page.locator('.site-nav [data-download-cta]');
  await expect(download).toHaveAttribute('href', /\/download\/?$/);
  await page.locator('.mobile-menu-toggle').click();
  const demo = page.locator('.mobile-nav-demo');
  await expect(demo).toHaveAttribute('href', /\/try\/?$/);
  await expect(demo).toHaveAttribute('target', '_blank');
  await expect(demo).toHaveAttribute('data-analytics-demo-launch', '');
  await expect(demo).toContainText('opens in a new tab');
});

test('compact header download label stays stable on a mobile user agent', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/136.0 Mobile Safari/537.36',
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.nav-download-cta [data-cta-label]')).toHaveText('Download');
});

test('navigation text and focus indicators meet contrast thresholds in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/product');
    const measured: Record<string, number> = {};
    const link = page.locator('.nav-links a[aria-current="page"]');
    const linkInk = parseColor(await link.evaluate((node) => getComputedStyle(node).color));
    const linkBg = await effectiveBackground(page, '.nav-links a[aria-current="page"]');
    expect(linkBg, `${colorScheme} selected link surface`).toBeTruthy();
    measured.currentPage = contrastRatio(linkInk, parseColor(linkBg!.bg));
    expect(measured.currentPage, `${colorScheme} selected link`).toBeGreaterThanOrEqual(4.5);

    const summary = page.locator('.nav-disclosure-summary').filter({ hasText: 'Learn' });
    await summary.focus();
    await page.keyboard.press('Enter');
    const description = page.locator('#learn-menu .nav-popover-description').first();
    const descriptionInk = parseColor(
      await description.evaluate((node) => getComputedStyle(node).color),
    );
    const descriptionBg = await effectiveBackground(page, '#learn-menu .nav-popover-description');
    expect(descriptionBg, `${colorScheme} menu surface`).toBeTruthy();
    measured.description = contrastRatio(descriptionInk, parseColor(descriptionBg!.bg));
    expect(measured.description, `${colorScheme} menu description`).toBeGreaterThanOrEqual(4.5);

    const menuLink = page.locator('#learn-menu .nav-popover-link').first();
    await menuLink.focus();
    const focus = await menuLink.evaluate((node) => getComputedStyle(node).outlineColor);
    const menuSurface = parseColor(
      (await effectiveBackground(page, '#learn-menu .nav-popover-link'))!.bg,
    );
    measured.focus = contrastRatio(parseColor(focus), menuSurface);
    expect(measured.focus, `${colorScheme} focus ring`).toBeGreaterThanOrEqual(3);

    const checkedTheme = page.locator('.nav-actions .theme-option[aria-checked="true"]');
    const checkedInk = parseColor(
      await checkedTheme.evaluate((node) => getComputedStyle(node).color),
    );
    const checkedBg = await effectiveBackground(
      page,
      '.nav-actions .theme-option[aria-checked="true"]',
    );
    measured.selectedTheme = contrastRatio(checkedInk, parseColor(checkedBg!.bg));
    expect(measured.selectedTheme, `${colorScheme} selected theme control`).toBeGreaterThanOrEqual(
      4.5,
    );

    const download = page.locator('.site-nav [data-download-cta]');
    const downloadInk = parseColor(await download.evaluate((node) => getComputedStyle(node).color));
    const downloadBg = await effectiveBackground(page, '.site-nav [data-download-cta]');
    measured.download = contrastRatio(downloadInk, parseColor(downloadBg!.bg));
    expect(measured.download, `${colorScheme} download CTA`).toBeGreaterThanOrEqual(4.5);
    console.info(`[navbar-contrast] ${colorScheme} ${JSON.stringify(measured)}`);
  }
});

test('CSS-only dark fallback paints the site without running JavaScript', async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('baseURL is required');
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    colorScheme: 'dark',
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/');
  const palette = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    page: getComputedStyle(document.body).backgroundColor,
    header: getComputedStyle(document.querySelector('.site-header')!).backgroundColor,
    text: getComputedStyle(document.body).color,
  }));
  expect(palette.theme).toBeUndefined();
  expect(palette.colorScheme).toBe('dark');
  expect(palette.page).toBe(palette.header);
  expect(parseColor(palette.text).luminance).toBeGreaterThan(parseColor(palette.page).luminance);
  await context.close();
});

test('session theme choice works when localStorage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem() {
          throw new DOMException('storage disabled', 'SecurityError');
        },
        setItem() {
          throw new DOMException('storage disabled', 'SecurityError');
        },
        removeItem() {
          throw new DOMException('storage disabled', 'SecurityError');
        },
      },
    });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.desktop-theme-toggle [data-theme-choice="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
});

test('native mobile disclosure keeps navigation usable with JavaScript disabled', async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('baseURL is required');
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 640 },
  });
  const page = await context.newPage();
  await page.goto('/');
  const fallback = page.locator('.mobile-nav-fallback');
  await expect(fallback).toBeVisible();
  await fallback.locator('summary').click();
  await expect(fallback.getByRole('link', { name: 'Known issues' })).toBeVisible();
  await expect(page.locator('.mobile-menu-toggle')).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-ready', '');
  await context.close();
});
