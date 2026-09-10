import { expect, test } from '@playwright/test';

test('coarse-pointer header controls have comfortable targets without overflow', async ({
  page,
}) => {
  for (const route of ['/', '/features', '/docs']) {
    await page.goto(route);
    const controls = page.locator('.site-nav .theme-option, .mobile-menu-toggle');
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      expect(box, `${route} header control should be measurable`).toBeTruthy();
      if (box) {
        expect(box.width, `${route} header control width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${route} header control height`).toBeGreaterThanOrEqual(44);
      }
    }

    await page.locator('.mobile-menu-toggle').click();
    const close = page.locator('.mobile-menu-close');
    const closeBox = await close.boundingBox();
    expect(closeBox, `${route} mobile close should be measurable`).toBeTruthy();
    if (closeBox) {
      expect(closeBox.width, `${route} mobile close width`).toBeGreaterThanOrEqual(44);
      expect(closeBox.height, `${route} mobile close height`).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} touch header overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
  }
});
