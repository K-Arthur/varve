import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/**
 * Site search + section anchors.
 *
 * The index is generated at build time, so these specs run against the built
 * output (both projects of playwright.website.config.ts) and use real corpus
 * pages and real product terms rather than synthetic fixtures.
 */

async function openWithTrigger(page: Page) {
  await page.locator('[data-search-open]').first().click();
  await expect(page.locator('[data-search-dialog]')).toBeVisible();
}

test('desktop trigger opens the dialog with popular destinations', async ({ page }) => {
  await page.goto('/');
  const trigger = page.locator('.nav-search-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.locator('[data-search-dialog]');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-search-input]')).toBeFocused();
  await expect(page.locator('[data-search-status]')).toHaveText('Popular destinations');
  const options = page.locator('[data-search-results] [role="option"]');
  await expect(options).toHaveCount(5);
  await expect(options.first()).toContainText('Getting started');
});

test('typing a real product term returns ranked results with highlights', async ({ page }) => {
  await page.goto('/');
  await openWithTrigger(page);
  await page.locator('[data-search-input]').fill('cmyk');
  const options = page.locator('[data-search-results] [role="option"]');
  await expect(options.first()).toBeVisible();
  await expect(page.locator('[data-search-status]')).toContainText(/result/);
  const firstText = await options.first().innerText();
  expect(firstText.toLowerCase()).toMatch(/cmyk|color/);
  await expect(page.locator('[data-search-results] mark').first()).toBeVisible();
});

test('the whole-query phrase ranks its page into the top results', async ({ page }) => {
  await page.goto('/');
  await openWithTrigger(page);
  await page.locator('[data-search-input]').fill('background removal');
  const options = page.locator('[data-search-results] [role="option"]');
  await expect(options.first()).toBeVisible();
  const urls = await page.locator('[data-search-results] .search-result__path').allInnerTexts();
  expect(urls.join('\n')).toMatch(/background-removal/);
});

test('misspelled words still find the right pages', async ({ page }) => {
  await page.goto('/');
  await openWithTrigger(page);
  await page.locator('[data-search-input]').fill('typoraphy');
  const options = page.locator('[data-search-results] [role="option"]');
  await expect(options.first()).toBeVisible();
  const text = (await options.allInnerTexts()).join('\n').toLowerCase();
  expect(text).toMatch(/typography/);
});

test('keyboard: / opens, arrows move, Enter follows the active result', async ({ page }) => {
  await page.goto('/');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(page.locator('[data-search-dialog]')).toBeVisible();
  await page.locator('[data-search-input]').fill('keyboard shortcuts');
  const options = page.locator('[data-search-results] [role="option"]');
  await expect(options.first()).toBeVisible();
  await expect(page.locator('[data-search-input]')).toHaveAttribute(
    'aria-activedescendant',
    'search-option-0',
  );
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-search-input]')).toHaveAttribute(
    'aria-activedescendant',
    'search-option-1',
  );
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/docs\/keyboard-shortcuts/);
});

test('Ctrl+K opens the dialog and Escape restores focus to the trigger', async ({ page }) => {
  await page.goto('/');
  const trigger = page.locator('.nav-search-trigger');
  await trigger.click();
  await expect(page.locator('[data-search-dialog]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-search-dialog]')).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('[data-search-dialog]')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('[data-search-dialog]')).not.toBeVisible();
});

test('no-results state explains the miss', async ({ page }) => {
  await page.goto('/');
  await openWithTrigger(page);
  await page.locator('[data-search-input]').fill('zzzzqqqq');
  await expect(page.locator('[data-search-status]')).toContainText('No matches');
  await expect(page.locator('[data-search-results] [role="option"]')).toHaveCount(0);
});

test('an unavailable index is reported honestly', async ({ page }) => {
  await page.route('**/search-index.json', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  await openWithTrigger(page);
  await page.locator('[data-search-input]').fill('cmyk');
  await expect(page.locator('[data-search-status]')).toContainText('unavailable in this build');
});

test('the open dialog passes an axe scan', async ({ page }) => {
  await page.goto('/');
  await openWithTrigger(page);
  await page.locator('[data-search-input]').fill('export');
  await expect(page.locator('[data-search-results] [role="option"]').first()).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('heading anchors are unique and targetable', async ({ page }) => {
  // Smooth scrolling (prefers-reduced-motion: no-preference) animates the
  // fragment jump; reduced motion makes the landing position synchronous.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/docs/tools/typography');
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('main h2[id], main h3[id]')].map((heading) => heading.id),
  );
  expect(ids.length).toBeGreaterThan(10);
  expect(new Set(ids).size).toBe(ids.length);

  const target = ids[3]!;
  await page.goto(`/docs/tools/typography#${target}`);
  const top = await page.evaluate((id) => {
    const element = document.getElementById(id);
    return element ? element.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
  }, target);
  expect(Math.abs(top)).toBeLessThan(200);
});

test('mobile menu exposes search and the dialog works at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.nav-search-trigger')).toBeHidden();
  await page.locator('.mobile-menu-toggle').click();
  const sheetSearch = page.locator('.mobile-nav-search');
  await expect(sheetSearch).toBeVisible();
  await sheetSearch.click();
  const dialog = page.locator('[data-search-dialog]');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-search-input]')).toBeFocused();
  await page.locator('[data-search-input]').fill('offline');
  await expect(page.locator('[data-search-results] [role="option"]').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('search dialog works in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await openWithTrigger(page);
  await page.locator('[data-search-input]').fill('print');
  await expect(page.locator('[data-search-results] [role="option"]').first()).toBeVisible();
  const background = await page
    .locator('[data-search-dialog]')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).not.toBe('rgb(255, 255, 255)');
});
