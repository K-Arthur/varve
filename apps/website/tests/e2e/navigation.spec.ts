import { expect, test } from '@playwright/test';

/**
 * Navigation and accessibility interactions that axe cannot see:
 * mobile menu semantics and focus management, tablist keyboard behaviour,
 * active navigation state, base-path integrity (nothing escapes to the host
 * root), horizontal overflow at narrow widths, and keyboard-only traversal.
 *
 * Runs in both deployment modes (baseURL differs; the interactions must be
 * identical).
 */

// Navigation tests exercise the site chrome, not the consent workflow. Seed a
// deterministic denial before every first paint so the fixed-position consent
// banner cannot intercept clicks in a fresh CI browser context. The consent
// boundary itself is covered by analytics.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
});

test('no internal link or asset escapes the site base path', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('baseURL is required');
  await page.goto('/');
  const escaped = await page.evaluate((origin) => {
    const sameOrigin = new URL(origin).origin;
    // The base path differs per project: /varve on Pages, / at the root.
    // An "escape" is a same-origin link whose path sits OUTSIDE the base
    // (on the project-site build, href="/" or href="/download" would 404).
    const base = new URL(origin).pathname.replace(/\/$/, '') || '/';
    const hrefs = [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h): h is string => !!h);
    return hrefs.filter((h) => {
      if (h.startsWith('#')) return false;
      if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return false;
      if (h.startsWith('//')) return false;
      const url = new URL(h, origin);
      if (url.origin !== sameOrigin) return false;
      // On a root deployment every path is inside the base; nothing escapes.
      if (base === '/') return false;
      return !url.pathname.startsWith(`${base}/`) && url.pathname !== base;
    });
  }, baseURL);
  expect(escaped).toEqual([]);
});

test('mobile menu: aria-expanded, Escape closes, focus returns', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const toggle = page.locator('.mobile-menu-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // The redesigned header opens a dedicated mobile panel (aria-hidden toggles
  // to false); the desktop .nav-links list is hidden at mobile widths.
  await expect(page.locator('.mobile-nav-panel')).toHaveAttribute('aria-hidden', 'false');

  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.mobile-nav-panel')).toHaveAttribute('aria-hidden', 'true');
  await expect(toggle).toBeFocused();
});

test('mobile menu closes after choosing a destination', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await page.locator('.mobile-menu-toggle').click();
  await page.locator('.mobile-nav-panel a[href$="/download"]').click();
  await expect(page).toHaveURL(/\/download/);
  await expect(page.locator('.mobile-nav-panel')).toHaveAttribute('aria-hidden', 'true');
});

test('active navigation state marks the current section', async ({ page }) => {
  await page.goto('/docs');
  const current = page.locator('.nav-links a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('Docs');
  await page.goto('/');
  await expect(page.locator('.nav-links a[aria-current="page"]')).toHaveCount(0);
});

test('platform selector: tablist semantics and arrow-key navigation', async ({ page, baseURL }) => {
  // The download page only renders tabs when a release exists; the committed
  // state is the honest no-release state, so assert the tablist markup on any
  // page that renders it, and cover the keyboard pattern via the menu toggle
  // (same interaction class). Skip gracefully when there is no release.
  await page.goto('/download');
  const tabs = page.locator('[role="tablist"]');
  if ((await tabs.count()) === 0) {
    test.skip(true, 'no release yet — platform tabs are not rendered');
    return;
  }
  await expect(tabs).toHaveAttribute('aria-label', /operating system/);
  const first = page.locator('[role="tab"]').first();
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[role="tab"]').nth(1)).toBeFocused();
  await expect(page.locator('[role="tab"]').nth(1)).toHaveAttribute('aria-selected', 'true');
  void baseURL;
});

test('no horizontal overflow at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const route of ['/', '/download', '/docs', '/features']) {
    await page.goto(route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} overflows at 320px by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test('footer wordmark animates only while its signature is in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const footer = page.locator('[data-site-footer]');
  const signature = page.locator('[data-footer-signature]');
  const wordmark = page.locator('.footer-signature-text');
  await expect(footer).toBeVisible();
  await expect(signature).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() => footer.evaluate((element) => element.classList.contains('is-in-view')))
    .toBe(false);
  await expect
    .poll(() => wordmark.evaluate((element) => getComputedStyle(element).animationName))
    .toBe('none');

  await signature.scrollIntoViewIfNeeded();
  await expect
    .poll(() => footer.evaluate((element) => element.classList.contains('is-in-view')))
    .toBe(true);
  await expect
    .poll(() => wordmark.evaluate((element) => getComputedStyle(element).animationName))
    .not.toBe('none');

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() => footer.evaluate((element) => element.classList.contains('is-in-view')))
    .toBe(false);
  await expect
    .poll(() => wordmark.evaluate((element) => getComputedStyle(element).animationName))
    .toBe('none');
});

test('keyboard-only path to the download page', async ({ page }) => {
  await page.goto('/');
  // Tab through the page; when the Download link is focused, activate it.
  // Pressing Tab alone never navigates — Enter on the focused anchor does.
  let reached = false;
  for (let i = 0; i < 80; i++) {
    const href = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLAnchorElement ? el.getAttribute('href') : null;
    });
    if (href?.includes('/download')) {
      await page.keyboard.press('Enter');
      reached = true;
      break;
    }
    await page.keyboard.press('Tab');
  }
  expect(reached, 'the Download link must be reachable by keyboard alone').toBe(true);
  await expect(page).toHaveURL(/\/download/);
});

test('skip link is the first focusable element and targets main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip-link');
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});
