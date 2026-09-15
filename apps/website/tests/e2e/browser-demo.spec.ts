/**
 * Browser demo documentation — content contract.
 *
 * The guide exists because the browser route's saving, offline, storage, and
 * install behavior differs from the desktop app. These assertions keep the
 * published promises aligned with the tested implementation: the offline
 * setup requirement, the storage-cleanup distinction, and the desktop-only
 * exclusions must all remain stated.
 */
import { expect, test } from '@playwright/test';

test.describe('browser demo docs', () => {
  test('guide states install, offline, and storage behavior', async ({ page }) => {
    await page.goto('/docs/browser-demo/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Browser Demo');
    await expect(page.getByRole('link', { name: /varve\.studio\/try/i }).first()).toBeVisible();

    const body = await page.locator('body').innerText();
    expect(body).toMatch(/one complete online visit/i);
    expect(body).toMatch(/not available offline yet/i);
    expect(body).toMatch(/Clear offline app copies/i);
    expect(body).toMatch(/documents and recovery copies are untouched/i);
    expect(body).toMatch(/desktop-only/i);
  });

  test('FAQ answers the browser question with a pointer to the guide', async ({ page }) => {
    await page.goto('/support/faq/', { waitUntil: 'domcontentloaded' });
    // FAQ answers live in collapsed disclosures; open the question the way a
    // reader does before asserting the answer's link is reachable.
    const question = page.getByText('Can I use Varve in a browser?');
    await expect(question).toBeVisible();
    await question.click();
    await expect(page.getByRole('link', { name: /Browser Demo & Offline guide/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Varve on Chromebook/i })).toBeVisible();
  });

  test('product page no longer claims there is no browser build', async ({ page }) => {
    await page.goto('/product/', { waitUntil: 'domcontentloaded' });
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/there is no hosted web app yet/i);
    expect(body).toMatch(/browser demo/i);
  });

  test('product workflow recording is user-controlled and stays unloaded until play', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('varve:website-analytics-consent', 'denied');
    });

    const videoRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/screenshots\/workflow\.(?:webm|mp4)(?:\?|$)/.test(request.url())) {
        videoRequests.push(request.url());
      }
    });

    const captures = [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'portrait', width: 800, height: 1280 },
      { name: 'narrow', width: 320, height: 720 },
    ];

    for (const capture of captures) {
      await page.setViewportSize({ width: capture.width, height: capture.height });
      await page.goto('/product/', { waitUntil: 'domcontentloaded' });
      const video = page.locator('.workflow-video');

      await expect(video).toHaveAttribute('controls', '');
      await expect(video).toHaveAttribute('preload', 'none');
      await expect(video).not.toHaveAttribute('autoplay');
      await expect(page.getByRole('link', { name: /Chromebook route chooser/i })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${capture.name} product page overflow`).toBeLessThanOrEqual(0);
      await page.waitForTimeout(250);
      expect(videoRequests, `${capture.name} video requests before play`).toEqual([]);

      await page.screenshot({
        path: testInfo.outputPath(`product-workflow-${capture.name}.png`),
        fullPage: true,
      });
    }
  });

  test('product workflow keeps the poster for reduced-motion visitors', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('varve:website-analytics-consent', 'denied');
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/product/', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.workflow-video')).toBeHidden();
    await expect(page.locator('.workflow-still')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('product-workflow-reduced-motion.png'),
      fullPage: true,
    });
  });
});
