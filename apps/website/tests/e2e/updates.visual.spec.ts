import { expect, test } from '@playwright/test';

async function expectReleaseSectionGap(page: import('@playwright/test').Page, minimum: number) {
  const spacing = await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll('.docs-section p')].find((element) =>
      element.textContent?.includes('The v0.5.0 feed includes'),
    );
    const heading = [...document.querySelectorAll('h2')].find((element) =>
      element.textContent?.includes('What happens on first launch?'),
    );
    if (!paragraph || !heading) return null;
    return {
      gap: heading.getBoundingClientRect().top - paragraph.getBoundingClientRect().bottom,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  if (!spacing) throw new Error('The release note paragraph or next section heading is missing.');
  expect(spacing.gap).toBeGreaterThanOrEqual(minimum);
  expect(spacing.scrollWidth).toBeLessThanOrEqual(spacing.viewportWidth);
}

test.describe('updates documentation spacing', () => {
  test('keeps the release platform note separated on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto('/docs/updates?test-motion=static');
    await expect(page.getByRole('heading', { name: 'Updates', exact: true })).toBeVisible();
    await expectReleaseSectionGap(page, 48);
    await expect(page).toHaveScreenshot('updates-spacing-desktop.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('keeps the release platform note readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto('/docs/updates?test-motion=static');
    await expect(page.getByRole('heading', { name: 'Updates', exact: true })).toBeVisible();
    await expectReleaseSectionGap(page, 40);
    await expect(page).toHaveScreenshot('updates-spacing-mobile.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
