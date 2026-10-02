import { expect, test } from '@playwright/test';

async function preparePage(
  page: import('@playwright/test').Page,
  route: string,
  heading: string,
  theme: 'light' | 'dark',
) {
  await page.addInitScript((value: string) => {
    localStorage.setItem('varve-theme', value);
    localStorage.setItem('varve:website-analytics-consent', 'denied');
  }, theme);
  await page.emulateMedia({
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });
  await page.goto(`${route}?test-motion=static`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('settings guide remains readable at narrow width and 200% text size', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await preparePage(page, '/docs/settings', 'Settings & Preferences', 'light');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('font-size', '200%', 'important');
  });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus-visible').first()).toBeVisible();
  await expect(page.locator('[data-testid="navigation-settings-help"]')).toBeVisible();
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    scrollX: document.documentElement.scrollLeft,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 2);
  expect(widths.bodyWidth).toBeLessThanOrEqual(widths.viewport + 2);
  await page
    .locator(':focus-visible')
    .first()
    .evaluate((element) => {
      (element as HTMLElement).blur();
    });
  await page.screenshot({
    path: info.outputPath('settings-narrow-light-200-percent.png'),
  });
  const footer = page.locator('.footer-download-band');
  await footer.scrollIntoViewIfNeeded();
  await footer.screenshot({ path: info.outputPath('settings-narrow-footer-cta.png') });

  await page.evaluate(() => window.scrollTo(0, 0));
  const menuToggle = page.locator('.mobile-menu-toggle');
  await menuToggle.click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.mobile-nav-sheet')).toBeVisible();
  const menuCta = page.locator('.mobile-nav-download .download-cta');
  await expect(menuCta).toBeVisible();
  const menuCtaWidths = await menuCta.evaluate((element) => ({
    content: element.clientWidth,
    scroll: element.scrollWidth,
    label: element
      .querySelector<HTMLElement>('.download-cta-label')
      ?.getBoundingClientRect()
      .toJSON(),
    labelScroll: element.querySelector<HTMLElement>('.download-cta-label')?.scrollWidth,
    beta: element
      .querySelector<HTMLElement>('.download-cta-beta')
      ?.getBoundingClientRect()
      .toJSON(),
    buttonPadding: getComputedStyle(element).paddingInline,
    labelWhiteSpace: getComputedStyle(element.querySelector<HTMLElement>('.download-cta-label')!)
      .whiteSpace,
  }));
  expect(
    menuCtaWidths.scroll,
    `mobile CTA contents must wrap without overflow: ${JSON.stringify(menuCtaWidths)}`,
  ).toBeLessThanOrEqual(menuCtaWidths.content + 2);
  const menuLinks = page.locator('.mobile-nav-links');
  const navScroll = page.locator('.mobile-nav-scroll');
  const navFooter = page.locator('.mobile-nav-download');
  const menuBounds = await navScroll.evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  const footerTop = await navFooter.evaluate((element) => element.getBoundingClientRect().top);
  expect(menuBounds.bottom).toBeLessThanOrEqual(footerTop + 1);
  expect(menuBounds.scrollHeight).toBeGreaterThan(menuBounds.clientHeight);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(widths.viewport + 2);
  await page.screenshot({ path: info.outputPath('settings-narrow-mobile-nav-open.png') });
  const supportLink = menuLinks.getByRole('link', { name: 'Support' });
  await supportLink.scrollIntoViewIfNeeded();
  await expect(supportLink).toBeVisible();
  await page.screenshot({ path: info.outputPath('settings-narrow-mobile-nav-scrolled.png') });
  await page.locator('.mobile-menu-close').click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(widths.viewport + 2);
});

test('settings guide dark theme keeps performance details visible', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await preparePage(page, '/docs/settings', 'Settings & Preferences', 'dark');
  const performance = page.locator('[data-testid="navigation-settings-help"]');
  await expect(performance.getByText(/500\s*ms for ordinary work/i)).toBeVisible();
  await expect(performance.getByText(/cold image or font readiness/i)).toBeVisible();
  const screenshot = page.getByRole('img', { name: /Performance settings dialog/ });
  await screenshot.scrollIntoViewIfNeeded();
  await expect(screenshot).toBeVisible();
  await expect
    .poll(() => screenshot.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.screenshot({
    path: info.outputPath('settings-dark-performance-guidance.png'),
    fullPage: true,
  });
});

test('product page dark theme states the canvas refinement limits', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await preparePage(page, '/product', 'What is Varve?', 'dark');
  await expect(
    page.getByText(/warm refinement targets are 500\s*ms for ordinary work/i),
  ).toBeVisible();
  await expect(page.getByText(/not quantified in the published evidence/i)).toBeVisible();
  await page.screenshot({
    path: info.outputPath('product-dark-canvas-refinement.png'),
    fullPage: true,
  });
});

test('settings guide remains readable in OS forced-colors mode', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await preparePage(page, '/docs/settings', 'Settings & Preferences', 'light');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect
    .poll(() => page.evaluate(() => matchMedia('(forced-colors: active)').matches))
    .toBe(true);
  const performance = page.locator('[data-testid="navigation-settings-help"]');
  await expect(performance.getByText(/Full resolution while navigating/i)).toBeVisible();
  await expect(page.getByRole('img', { name: /Performance settings dialog/ })).toBeVisible();
  await page.screenshot({
    path: info.outputPath('settings-high-contrast-performance-guidance.png'),
    fullPage: true,
  });
});

test('performance guide dark theme documents preview recovery and browser scope', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await preparePage(page, '/docs/performance', 'Performance on lower-memory devices', 'dark');
  await expect(
    page.getByText(/warm refinement targets are 500\s*ms for ordinary work/i),
  ).toBeVisible();
  await expect(page.getByText(/limit of the current public host/i)).toBeVisible();
  await page.screenshot({
    path: info.outputPath('performance-dark-canvas-refinement.png'),
    fullPage: true,
  });
});
