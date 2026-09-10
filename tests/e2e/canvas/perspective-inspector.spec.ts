import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const REVIEW_DIR = path.resolve('reports/ui-review/perspective');
const FIXTURE = path.resolve('tests/e2e/fixtures/test-image.png');

test.describe('Perspective inspector UI', () => {
  test('offers canvas entry and precise corner controls', async ({ page }) => {
    test.setTimeout(120000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await navigateToEditor(page);

    await page.locator('#file-import-input').setInputFiles(FIXTURE);
    const layer = page.getByRole('treeitem').first();
    await expect(layer).toBeVisible({ timeout: 15000 });
    await layer.click();

    await page.getByRole('menuitem', { name: /^Object$/i }).click();
    await expect(page.getByRole('menuitem', { name: /^Perspective Image/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /resize image/i })).toBeVisible();
    await page.getByRole('menuitem', { name: /^Perspective Image/ }).click();
    await expect(page.locator('button[aria-label^="Perspective corner"]')).toHaveCount(4);
    await page.getByRole('button', { name: 'Cancel perspective' }).click();

    const section = page.getByRole('button', { name: 'Perspective', exact: true });
    await expect(section).toBeVisible({ timeout: 10000 });
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(REVIEW_DIR, '01-collapsed.png'), fullPage: false });

    await section.click();
    const perspectiveHint = page.getByText(
      /Distort this image with a source-preserving four-corner perspective transform/,
    );
    await expect(perspectiveHint).toBeVisible();
    await perspectiveHint.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest' }),
    );
    await expect(page.getByRole('button', { name: 'Edit Perspective' })).toBeVisible();
    await page.screenshot({ path: path.join(REVIEW_DIR, '02-entry.png'), fullPage: false });

    await page.getByRole('button', { name: 'Edit Perspective' }).click();
    const handles = page.locator('button[aria-label^="Perspective corner"]');
    await expect(handles).toHaveCount(4);
    await page.screenshot({ path: path.join(REVIEW_DIR, '03-canvas-edit.png'), fullPage: false });

    const bottomRight = handles.nth(2);
    const before = await bottomRight.boundingBox();
    expect(before).toBeTruthy();
    await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
    await page.mouse.down();
    await page.mouse.move(before!.x + before!.width / 2 + 24, before!.y + before!.height / 2 + 12);
    await page.mouse.up();

    await expect
      .poll(() => page.getByRole('button', { name: 'Apply perspective' }).count())
      .toBe(1);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('spinbutton', { name: 'Top right X (px)' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: 'Edit on Canvas' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Bottom right X (px)' })).not.toHaveValue(
      '100',
    );
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const canvas = document.querySelector(
              'canvas.editor-canvas__content-layer',
            ) as HTMLCanvasElement | null;
            if (!canvas) return false;
            const ctx = canvas.getContext('2d');
            if (!ctx || canvas.width === 0 || canvas.height === 0) return false;
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < pixels.length; i += 4 * 32) {
              const r = pixels[i]!;
              const g = pixels[i + 1]!;
              const b = pixels[i + 2]!;
              if (Math.max(r, g, b) - Math.min(r, g, b) > 80 && Math.max(r, g, b) > 120) {
                return true;
              }
            }
            return false;
          }),
        { timeout: 10000 },
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(REVIEW_DIR, '04-numeric-controls.png'),
      fullPage: false,
    });
  });
});
