import { expect, test } from '@playwright/test';

/** Responsive visual evidence is run once against the representative /varve build. */
test('header and open navigation remain composed across themes, widths, landscape, and enlarged text', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'ghpages',
    'root-mode destination parity is covered by navbar.spec.ts',
  );

  const widths = [320, 390, 767, 768, 1024, 1279, 1280, 1440];
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of widths) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
      await page.goto('/');
      const header = page.locator('.site-header');
      const nav = page.locator('.site-nav');
      await expect(header).toBeVisible();
      const layout = await nav.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const children = [...node.children].map((child) => {
          const rect = child.getBoundingClientRect();
          return { left: rect.left, right: rect.right, display: getComputedStyle(child).display };
        });
        return {
          width: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          navWidth: node.clientWidth,
          navScrollWidth: node.scrollWidth,
          bounds: { left: bounds.left, right: bounds.right },
          children,
        };
      });
      expect(layout.navScrollWidth, `${colorScheme} ${width}px nav overflow`).toBeLessThanOrEqual(
        layout.navWidth,
      );
      for (const child of layout.children.filter((item) => item.display !== 'none')) {
        expect(child.left, `${colorScheme} ${width}px child left edge`).toBeGreaterThanOrEqual(
          layout.bounds.left - 1,
        );
        expect(child.right, `${colorScheme} ${width}px child right edge`).toBeLessThanOrEqual(
          layout.bounds.right + 1,
        );
      }
      expect(await page.locator('.mobile-menu-toggle').isVisible()).toBe(width < 768);
      expect(await page.locator('.nav-links').isVisible()).toBe(width >= 768);
      expect(await page.locator('.nav-search-trigger').isVisible()).toBe(width >= 1280);
      if (width <= 384) {
        const headerRow = await page.evaluate(() => {
          const logo = document.querySelector('.site-logo')!.getBoundingClientRect();
          const actions = document.querySelector('.nav-actions')!.getBoundingClientRect();
          return {
            logoCenter: logo.top + logo.height / 2,
            actionsCenter: actions.top + actions.height / 2,
          };
        });
        expect(
          Math.abs(headerRow.actionsCenter - headerRow.logoCenter),
          `${colorScheme} ${width}px primary controls share the phone row`,
        ).toBeLessThanOrEqual(1);
      }

      const tag = `${colorScheme}-${width}`;
      await page.screenshot({ path: testInfo.outputPath(`navbar-${tag}-header.png`) });
      if (width < 768) {
        await page.setViewportSize({ width, height: 620 });
        await page.evaluate(() => window.scrollTo(0, 500));
        await page.locator('.mobile-menu-toggle').click();
        const dialog = page.locator('.mobile-nav-dialog');
        const rect = await dialog.boundingBox();
        expect(rect?.x).toBe(0);
        expect(rect?.y).toBe(0);
        expect(rect?.width).toBe(width);
        expect(rect?.height).toBe(620);
        await dialog.getByRole('link', { name: 'Known issues' }).scrollIntoViewIfNeeded();
        expect(
          await page.locator('.mobile-nav-scroll').evaluate((node) => node.scrollTop),
        ).toBeGreaterThan(0);
        await page.screenshot({ path: testInfo.outputPath(`navbar-${tag}-open-menu.png`) });
        await page.keyboard.press('Escape');
        await expect(dialog).not.toHaveAttribute('open', '');
      } else {
        const learn = page.locator('.nav-disclosure-summary').filter({ hasText: 'Learn' });
        await learn.click();
        await expect(page.locator('#learn-menu')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`navbar-${tag}-open-menu.png`) });
        await page.keyboard.press('Escape');
      }
    }
  }

  await page.setViewportSize({ width: 667, height: 375 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.locator('.mobile-menu-toggle').click();
  const landscapeDialog = page.locator('.mobile-nav-dialog');
  await expect(landscapeDialog.getByRole('link', { name: 'Known issues' })).toBeVisible();
  await landscapeDialog.getByRole('link', { name: 'Contact' }).scrollIntoViewIfNeeded();
  expect(
    await page.locator('.mobile-nav-scroll').evaluate((node) => node.scrollTop),
  ).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('navbar-dark-landscape-open-menu.png') });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 150% !important; }' });
  const enlarged = await page.locator('.site-nav').evaluate((node) => ({
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
    pageWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(enlarged.scrollWidth).toBeLessThanOrEqual(enlarged.width);
  expect(enlarged.pageWidth).toBeLessThanOrEqual(enlarged.viewport);
  await page.screenshot({ path: testInfo.outputPath('navbar-light-320-enlarged-text.png') });
});
