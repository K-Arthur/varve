/**
 * FAQ disclosure visual capture — review artifacts, not assertions.
 *
 * Writes rendered states to `reports/disclosure-review-2026-09-15/` (generated,
 * gitignored) for human inspection of the FAQ chevrons, focus ring, open/closed
 * states, print reveal, and the changelog's older-releases label. The
 * behavioural contract lives in `faq-disclosure.spec.ts`.
 */
import { expect, test } from '@playwright/test';

const OUT = 'reports/disclosure-review-2026-09-15';

test('captures FAQ disclosure states', async ({ page }) => {
  await page.goto('/support/faq');
  const first = page.locator('details.faq-item').first();
  await expect(first).toBeVisible();
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${OUT}/website-faq-closed.png`,
    clip: { x: 0, y: 0, width: 1280, height: 720 },
  });

  await first.locator('summary').focus();
  await page.screenshot({
    path: `${OUT}/website-faq-focused.png`,
    clip: { x: 0, y: 0, width: 1280, height: 720 },
  });

  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('open', '');
  await page.screenshot({
    path: `${OUT}/website-faq-open.png`,
    clip: { x: 0, y: 0, width: 1280, height: 720 },
  });

  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: `${OUT}/website-faq-print.png`, fullPage: false });
});

test('captures compare FAQ and changelog disclosure', async ({ page }) => {
  await page.goto('/compare');
  const compareFaq = page.locator('details.faq-item').first();
  await compareFaq.scrollIntoViewIfNeeded();
  await compareFaq.locator('summary').click();
  await expect(compareFaq).toHaveAttribute('open', '');
  await compareFaq.locator('summary').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${OUT}/website-compare-faq-open.png`,
    clip: { x: 0, y: 0, width: 1280, height: 720 },
  });

  await page.goto('/changelog');
  const older = page.locator('details.changelog-older');
  if ((await older.count()) > 0) {
    await older.scrollIntoViewIfNeeded();
    await older.locator('summary').click();
    await expect(older).toHaveAttribute('open', '');
    await older.locator('summary').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${OUT}/website-changelog-older-open.png`,
      clip: { x: 0, y: 0, width: 1280, height: 720 },
    });
  }
});
