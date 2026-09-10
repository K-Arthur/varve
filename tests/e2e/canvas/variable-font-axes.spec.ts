import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

/**
 * Variable font axes in the real editor.
 *
 * The inspector panel existed but was unreachable: every bundled variable
 * family was registered without axis data, so isVariable() was false and the
 * section returned null for any font the product ships.
 */

async function typeSpecimen(page: import('@playwright/test').Page, family: string) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 20000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');

  await page.keyboard.press('t');
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 800, box.y + 320, { steps: 16 });
  await page.mouse.up();
  await page.keyboard.type('Aa', { delay: 30 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('v');
  await page.getByRole('treeitem').first().click();
  await page.waitForTimeout(400);

  // Set the family through the inspector's own font control.
  const fontInput = page.getByRole('combobox', { name: /font/i }).first();
  await fontInput.click();
  await fontInput.fill(family);
  await page.waitForTimeout(600);
  await page
    .getByRole('option', { name: new RegExp(family, 'i') })
    .first()
    .click();
  await page.waitForTimeout(600);
}

async function openVariableAxes(page: import('@playwright/test').Page) {
  const trigger = page
    .locator('button.insp-disclosure__trigger')
    .filter({ hasText: 'Variable Font Axes' });
  await expect(trigger).toBeVisible({ timeout: 10000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
}

test.describe('variable font axes', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('a bundled variable family exposes its weight axis', async ({ page }) => {
    test.setTimeout(120000);
    await typeSpecimen(page, 'Geist Variable');

    await openVariableAxes(page);
    await expect(page.getByRole('slider', { name: /Weight \(wght\)/ })).toBeVisible();
  });

  test('the axis range comes from the font, not a generic table', async ({ page }) => {
    test.setTimeout(120000);
    await typeSpecimen(page, 'Geist Variable');
    await openVariableAxes(page);

    const slider = page.getByRole('slider', { name: /Weight \(wght\)/ });
    // Geist declares 100-900. The generic fallback would say 1-1000.
    await expect(slider).toHaveAttribute('min', '100');
    await expect(slider).toHaveAttribute('max', '900');
  });

  test('dragging an axis redraws the glyphs', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await typeSpecimen(page, 'Geist Variable');
    await openVariableAxes(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await canvas.screenshot();
    await canvas.screenshot({ path: testInfo.outputPath('variable-font-before-weight.png') });
    await page.getByRole('slider', { name: /Weight \(wght\)/ }).fill('900');
    await page.waitForTimeout(800);

    const after = await canvas.screenshot();
    await canvas.screenshot({ path: testInfo.outputPath('variable-font-after-weight.png') });
    expect(Buffer.compare(before, after)).not.toBe(0);
    const inkPixels = await page.evaluate(() => {
      const element = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement | null;
      if (!element) return 0;
      const pixels = element
        .getContext('2d')
        ?.getImageData(0, 0, element.width, element.height).data;
      if (!pixels) return 0;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          pixels[i]! < 180 &&
          pixels[i + 1]! < 180 &&
          pixels[i + 2]! < 180 &&
          pixels[i + 3]! > 0
        ) {
          count += 1;
        }
      }
      return count;
    });
    expect(inkPixels).toBeGreaterThan(20);
  });
});
