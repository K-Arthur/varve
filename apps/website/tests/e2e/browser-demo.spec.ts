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
    await expect(page.getByText('Can I use Varve in a browser?')).toBeVisible();
    await expect(page.getByRole('link', { name: /Browser Demo & Offline guide/i })).toBeVisible();
  });

  test('product page no longer claims there is no browser build', async ({ page }) => {
    await page.goto('/product/', { waitUntil: 'domcontentloaded' });
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/there is no hosted web app yet/i);
    expect(body).toMatch(/browser demo/i);
  });
});
