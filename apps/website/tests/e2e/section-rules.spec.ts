import { expect, test } from '@playwright/test';

/**
 * Section-boundary rules.
 *
 * Adjacent marketing sections must not both draw the shared boundary: two
 * stacked 1px borders read as a heavier 2px seam (and compound fractional-DPR
 * artifacts). The band that *starts* owns the rule; the band above it does
 * not draw a bottom edge. This was true on the homepage path from the product
 * showcase into the interface section (found 2026-09-15, fixed by removing
 * the showcase's bottom border).
 */
test('homepage section boundary is a single 1px rule', async ({ page }) => {
  await page.goto('/');
  const boundary = await page.evaluate(() => {
    const showcase = document.querySelector('.showcase');
    const next = document.querySelector('.interface-section');
    if (!showcase || !next) throw new Error('homepage sections not found');
    return {
      showcaseBottom: getComputedStyle(showcase).borderBottomWidth,
      nextTop: getComputedStyle(next).borderTopWidth,
      adjacent: showcase.nextElementSibling === next,
    };
  });

  expect(boundary.adjacent, 'showcase must be directly followed by the interface section').toBe(
    true,
  );
  const drawn = [boundary.showcaseBottom, boundary.nextTop].filter((width) => width !== '0px');
  expect(drawn, 'exactly one edge may draw the shared boundary').toHaveLength(1);
  expect(boundary.nextTop).toBe('1px');
});
