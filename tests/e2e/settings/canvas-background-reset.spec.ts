/**
 * Canvas background — set via Settings, then Reset back to default.
 *
 * The default canvas background is the theme sunken surface, not a stored
 * color; Reset must remove Document.canvasBackground rather than write a
 * color. Asserted through real rendered canvas pixels, not swatch styles.
 */
import { expect, type Page, test } from '@playwright/test';
import { canvasLocator, navigateToEditor } from '../shared';

async function openSettings(page: Page) {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim() === 'File' && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim().toLowerCase().startsWith('settings') && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await expect(page.locator('dialog.varve-dialog--settings')).toHaveAttribute('open', '', {
    timeout: 10000,
  });
}

async function closeSettings(page: Page) {
  // Escape is unreliable here: the app's shortcut layer and the nested
  // picker restore flows can swallow the cancel event. Use the dialog's
  // dedicated close control.
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('dialog.varve-dialog--settings')).not.toHaveAttribute('open');
}

async function readBoardPixel(page: Page): Promise<number[]> {
  const canvas = canvasLocator(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  const sx = box.x + 300;
  const sy = box.y + 60;
  return page.evaluate(
    ([sx, sy]: number[]) => {
      if (sx === undefined || sy === undefined) throw new Error('missing pixel coordinates');
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context on content canvas');
      const d = ctx.getImageData(
        Math.round((sx - rect.left) * scaleX),
        Math.round((sy - rect.top) * scaleY),
        1,
        1,
      ).data;
      return [d[0]!, d[1]!, d[2]!, d[3]!];
    },
    [sx, sy],
  );
}

test('set canvas background from Settings, then Reset returns the board to the theme default', async ({
  page,
}) => {
  await navigateToEditor(page);

  // The first frame may not be painted yet; wait for an opaque board pixel.
  await expect.poll(async () => (await readBoardPixel(page))[3], { timeout: 15_000 }).toBe(255);
  const defaultPixel = await readBoardPixel(page);

  await openSettings(page);
  const settingsDialog = page.locator('dialog.varve-dialog--settings');

  // Reset is offered but inert while the document has no custom background.
  const resetButton = settingsDialog.getByRole('button', { name: 'Reset', exact: true });
  await expect(resetButton).toBeDisabled();

  // Set a saturated custom color through the picker.
  await settingsDialog.getByRole('button', { name: 'Canvas background', exact: true }).click();
  const pickerDialog = page.getByRole('dialog', { name: /pick canvas background/i });
  await expect(pickerDialog).toBeVisible();
  await pickerDialog.getByLabel('Hex color').fill('#ff0000');
  await pickerDialog.getByLabel('Hex color').press('Enter');
  // Escape would bubble past the picker and close the Settings dialog too.
  await pickerDialog.getByRole('button', { name: 'Dismiss colour picker' }).click();
  await expect(pickerDialog).toBeHidden();

  await closeSettings(page);

  await expect
    .poll(async () => readBoardPixel(page), { timeout: 10_000 })
    .toEqual([255, 0, 0, 255]);

  // Reset must restore the theme surface — remove the stored color.
  await openSettings(page);
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
  await closeSettings(page);

  await expect.poll(async () => readBoardPixel(page), { timeout: 10_000 }).toEqual(defaultPixel);
});
