import { expect, test } from '@playwright/test';

test.describe('Effect Studio marketing surface', () => {
  test('feature page communicates the editable preview workflow and reflows on mobile', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto('/features/effect-studio');

    await expect(
      page.getByRole('heading', { name: 'Preview the treatment. Keep the source.' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'See what will change before it becomes history.' }),
    ).toBeVisible();
    await expect(page.getByText(/accepted state and current candidate/i)).toBeVisible();
    await expect(page.getByText(/explicit duplication/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Inspect at scale' })).toBeVisible();
    await expect(page.getByText(/100% and 200% show its encoded pixels/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read the Effect Studio guide' })).toHaveAttribute(
      'href',
      /\/docs\/tools\/effect-studio$/,
    );

    const desktopLayout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(desktopLayout.documentWidth).toBeLessThanOrEqual(desktopLayout.viewportWidth + 1);
    await page.screenshot({
      path: testInfo.outputPath('effect-studio-feature-light.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await page.locator('.feature-page').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth + 1);
  });

  test('guide and indexes expose the same honest boundaries', async ({ page }) => {
    await page.goto('/docs/tools/effect-studio');
    await expect(
      page.getByRole('heading', { name: 'Accepted state versus current candidate' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fit and inspection scale' })).toBeVisible();
    await expect(
      page.getByText(/removes only filters owned by the active preview session/i),
    ).toBeVisible();
    await expect(
      page.getByText(/Fit contains the complete rendered preview bitmap/i),
    ).toBeVisible();

    await page.goto('/features');
    await expect(page.getByRole('link', { name: /Effect Studio/i })).toBeVisible();
    await page.goto('/docs');
    await expect(page.getByRole('link', { name: /Effect Studio/i })).toBeVisible();
  });
});
