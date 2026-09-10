import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function selectCustomOption(
  page: import('@playwright/test').Page,
  label: string,
  optionLabel: string,
) {
  const combo = page.getByRole('combobox', { name: label });
  await combo.click();
  const listbox = page.getByRole('listbox', { name: label });
  await expect(listbox).toBeVisible({ timeout: 3000 });
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click();
  await page.waitForTimeout(200);
}

/**
 * Real-browser vertical text acceptance check. This intentionally drives the
 * Text tool and its creation defaults, then captures the actual compositor
 * surface so a CSS-only textarea change cannot pass as canvas support.
 */
test.describe('vertical text canvas workflow', () => {
  test('creates vertical-rl text, edits it, and converts it to vertical-lr', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await page.keyboard.press('t');
    const options = page.locator('.tool-options__popover');
    await expect(options).toBeVisible({ timeout: 5000 });
    await options.getByRole('combobox', { name: 'Writing mode' }).selectOption('vertical-rl');
    await options.getByRole('combobox', { name: 'Character orientation' }).selectOption('mixed');

    await page.mouse.click(box.x + 260, box.y + 180);
    await page.keyboard.insertText('縦書き ABC 12「東京」、\u{1f642}');
    const editSurface = page.locator('textarea[data-text-edit-surface="true"]');
    await expect(editSurface).toHaveAttribute('data-writing-mode', 'vertical-rl');
    await expect(editSurface).toHaveAttribute('data-text-orientation', 'mixed');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(500);

    const verticalRlPath = testInfo.outputPath('vertical-rl.png');
    await canvas.screenshot({ path: verticalRlPath });

    const typography = page.getByRole('combobox', { name: 'Writing mode (not rotation)' });
    await expect(typography).toBeVisible({ timeout: 5000 });
    await selectCustomOption(page, 'Writing mode (not rotation)', 'Vertical LR');
    await expect(typography).toHaveText('Vertical LR');

    const verticalLrPath = testInfo.outputPath('vertical-lr.png');
    await canvas.screenshot({ path: verticalLrPath });

    const inkPixels = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext('2d');
      if (!context) return 0;
      const pixels = context.getImageData(0, 0, target.width, target.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          pixels[i]! < 170 &&
          pixels[i + 1]! < 190 &&
          pixels[i + 2]! < 210 &&
          pixels[i + 3]! > 0
        ) {
          count += 1;
        }
      }
      return count;
    });
    expect(inkPixels).toBeGreaterThan(100);
  });
});
