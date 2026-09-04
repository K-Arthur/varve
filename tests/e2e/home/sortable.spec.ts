import { expect, test } from '@playwright/test';

/** The desktop Vite fixture renders HomeShell with 20 deterministic files. */
test.describe('Home sortable file grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/e2e.html');
    await page.locator('.varve-home__toolbar').waitFor({ timeout: 45000 });
    await page.getByRole('button', { name: /^all files/i }).click();
    await page.locator('.file-card').first().waitFor();
  });

  test('reorders through a dedicated handle and keeps the card body non-draggable', async ({
    page,
  }) => {
    const cards = page.locator('.file-card');
    const handles = page.locator('.file-card__drag-handle');
    await expect(cards).toHaveCount(20);
    await expect(handles).toHaveCount(20);
    await expect(cards.first()).not.toHaveAttribute('draggable');

    const source = await handles.first().boundingBox();
    if (!source) throw new Error('source handle geometry unavailable');
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 30, source.y + source.height / 2 + 30);

    // The active item transforms the surrounding grid; read the target after
    // activation so the pointer lands on its current visual rectangle.
    const target = await cards.nth(1).boundingBox();
    if (!target) throw new Error('target card geometry unavailable');
    const dropPoint = {
      x: target.x + target.width / 2,
      y: target.y + target.height * 0.75,
    };
    await page.mouse.move(dropPoint.x, dropPoint.y, {
      steps: 6,
    });
    await page.waitForTimeout(100);
    await expect(page.locator('.varve-sortable-overlay')).toBeVisible();
    await page.waitForTimeout(50);
    await page.mouse.up();

    await expect
      .poll(async () => cards.first().locator('.file-card__name').textContent())
      .toBe('Design 2');
    await expect
      .poll(async () => cards.nth(1).locator('.file-card__name').textContent())
      .toBe('Design 1');
  });
});
