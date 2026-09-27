import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const captures = resolve('docs/screenshots/dtcg-website-2026-09-25');

for (const variant of [
  { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
  { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
] as const) {
  test(`design token workflow and limits remain readable: ${variant.name}`, async ({
    page,
  }, info) => {
    mkdirSync(captures, { recursive: true });
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.emulateMedia({ colorScheme: variant.theme, reducedMotion: 'reduce' });
    const base = String(info.project.use.baseURL).replace(/\/$/, '');
    await page.goto(`${base}/features/design-tokens`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'A token edited in two places should survive both edits.',
    );
    await expect(
      page.getByText('View › Panels › Variables and Tokens…', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Create locally or start with a file' }),
    ).toBeVisible();
    await expect(page.getByText(/rem requires document font context/)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
    await expect(
      page.getByText(/keep the project files to retain other contexts and composition/),
    ).toBeVisible();
    await expect(
      page.getByText(/No background watcher, no Git-backed source, no external write-back/),
    ).toBeVisible();
    await expect(
      page.getByText(/generated CSS omitted the token-level JSON Pointer alias/),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /dated interoperability evidence and consumer probe/ }),
    ).toBeVisible();
    const artwork = page.getByRole('img', { name: /blue rectangle with its fill linked/ });
    await expect(artwork).toBeVisible();
    await expect
      .poll(() => artwork.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(1600);
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport + 1);
    const matrix = page.getByRole('region', { name: /Design token capabilities/ });
    await matrix.focus();
    await expect(matrix).toBeFocused();
    await matrix.evaluate((element) =>
      element.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const table = document.querySelector('.matrix-scroll')!.getBoundingClientRect();
          const header = document.querySelector('.site-header')!.getBoundingClientRect();
          return table.top >= header.bottom;
        }),
      )
      .toBe(true);
    const box = await matrix.boundingBox();
    if (!box) throw new Error('The capability table has no visible geometry.');
    const clip = { ...box, height: Math.min(box.height, variant.height - box.y) };
    // Capture the visible viewport rather than letting an oversized element
    // screenshot recenter the page and place its sticky header over a row.
    await page.screenshot({
      path: resolve(captures, `${info.project.name}-${variant.name}-matrix.png`),
      clip,
    });
    if (variant.width < 760) {
      await matrix.hover();
      await page.mouse.wheel(900, 0);
      await expect.poll(() => matrix.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await page.screenshot({
        path: resolve(captures, `${info.project.name}-${variant.name}-matrix-limits.png`),
        clip,
      });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page
      .locator('.page-hero')
      .screenshot({ path: resolve(captures, `${info.project.name}-${variant.name}-hero.png`) });
    await page.screenshot({
      path: resolve(captures, `${info.project.name}-${variant.name}.png`),
      fullPage: true,
    });
  });
}
