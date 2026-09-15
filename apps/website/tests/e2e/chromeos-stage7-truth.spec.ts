import { expect, test } from '@playwright/test';

/**
 * The Chromebook chooser is a marketing surface, so its device boundary needs
 * a browser regression of its own. This deliberately rejects universal-support
 * wording while requiring the experimental/no-hardware caveat to remain visible.
 */
test('Chromebook route copy stays experimental and device-qualified', async ({ page }) => {
  await page.goto('/docs/chromebook/', { waitUntil: 'domcontentloaded' });

  const body = await page.locator('body').innerText();
  expect(body).toMatch(/both Chromebook routes are experimental/i);
  expect(body).toMatch(/no physical Chromebook run has been recorded/i);
  expect(body).toMatch(/device capabilities can limit the result/i);
  expect(body).not.toMatch(/works on any current Chromebook/i);
});

test('Linux route does not promise ChromeOS graphics acceleration', async ({ page }) => {
  await page.goto('/docs/chromebook/', { waitUntil: 'domcontentloaded' });

  const linuxRoute = page.getByRole('heading', { name: /Linux application/i }).locator('..');
  await expect(linuxRoute).toContainText(/does not promise acceleration/i);
  await expect(linuxRoute).toContainText(/version\/device dependent/i);
});
