import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Color picker workflow', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function createRect(page: import('@playwright/test').Page) {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  }

  async function openFillPicker(page: import('@playwright/test').Page) {
    const swatch = page.locator('.insp-swatch[aria-label="Fill colour"]');
    await expect(swatch).toBeVisible({ timeout: 5000 });
    await swatch.click();
    const dialog = page.getByRole('dialog', { name: /pick fill colour/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    return dialog;
  }

  async function waitForSwatchBackground(page: import('@playwright/test').Page, expected: string) {
    await page.waitForFunction(
      (fragment) => {
        const el = document.querySelector('.insp-swatch[aria-label="Fill colour"]');
        return !!el && (el as HTMLElement).style.background.includes(fragment);
      },
      expected,
      { timeout: 5000 },
    );
  }

  test('enters a hex color and applies it to the fill (scene + renderer)', async ({ page }) => {
    await createRect(page);
    await openFillPicker(page);

    const hexInput = page.getByRole('textbox', { name: 'Hex color' });
    await expect(hexInput).toBeVisible();
    await hexInput.click();
    await hexInput.fill('#ff0000');
    await hexInput.press('Enter');

    // Inspector swatch reflects the committed fill color.
    await waitForSwatchBackground(page, 'rgb(255, 0, 0)');

    // Rendered canvas shows the new fill: poll for the red pixel at the drag
    // area center (the render worker repaints asynchronously).
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector(
          'canvas.editor-canvas__content-layer',
        ) as HTMLCanvasElement | null;
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        try {
          const d = ctx.getImageData(275, 250, 1, 1).data;
          const r = d[0] ?? 0;
          const g = d[1] ?? 0;
          const b = d[2] ?? 0;
          return r > 180 && g < 70 && b < 70;
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 5000 },
    );

    // Close, reopen — value persists.
    await page.getByRole('button', { name: /^done$/i }).click();
    await expect(page.getByRole('dialog', { name: /pick fill colour/i })).toBeHidden();
    await openFillPicker(page);
    await expect(page.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#ff0000');
  });

  test('8-digit hex sets alpha; 6-digit hex preserves it', async ({ page }) => {
    await createRect(page);
    await openFillPicker(page);
    const hexInput = page.getByRole('textbox', { name: 'Hex color' });

    await hexInput.click();
    await hexInput.fill('#00ff0080');
    await hexInput.press('Enter');
    await waitForSwatchBackground(page, 'rgba(0, 255, 0, 0.5)');

    // A 6-digit entry keeps the alpha.
    await hexInput.click();
    await hexInput.fill('#0000ff');
    await hexInput.press('Enter');
    await waitForSwatchBackground(page, 'rgba(0, 0, 255, 0.5)');
  });

  test('mode switches keep the picker open and the color stable', async ({ page }) => {
    await createRect(page);
    await openFillPicker(page);

    const hexInput = page.getByRole('textbox', { name: 'Hex color' });
    await hexInput.click();
    await hexInput.fill('#6496c8');
    await hexInput.press('Enter');

    // RGB fields (scoped to the dialog — the inspector has other R/G/B fields)
    const dialog = page.getByRole('dialog', { name: /pick fill colour/i });
    await dialog.getByRole('button', { name: 'RGB', exact: true }).click();
    await expect(dialog.getByRole('spinbutton', { name: 'R', exact: true })).toHaveValue('100');
    await expect(dialog.getByRole('spinbutton', { name: 'G', exact: true })).toHaveValue('150');
    await expect(dialog.getByRole('spinbutton', { name: 'B', exact: true })).toHaveValue('200');

    // Space switch to CMYK: picker stays open, values are conversions.
    await dialog.getByRole('radio', { name: 'CMYK' }).click();
    await expect(dialog.getByRole('spinbutton', { name: 'C', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: /pick fill colour/i })).toBeVisible();

    // Back to RGB — still open, hex value unchanged (no drift).
    await dialog.getByRole('radio', { name: 'RGB' }).click();
    await dialog.getByRole('button', { name: 'HEX', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#6496c8');
    await expect(page.getByRole('dialog', { name: /pick fill colour/i })).toBeVisible();
  });

  test('rejects invalid hex without corrupting the document color', async ({ page }) => {
    await createRect(page);
    const dialog = await openFillPicker(page);
    const hexInput = dialog.getByRole('textbox', { name: 'Hex color' });

    await hexInput.click();
    await hexInput.fill('zzz-not-hex');
    await hexInput.press('Enter');
    await expect(dialog.locator('.color-fields__error')).toContainText('valid hex color');

    // The swatch still shows the previous color (dialog stayed open).
    await expect(page.getByRole('dialog', { name: /pick fill colour/i })).toBeVisible();
    await page.getByRole('button', { name: /^done$/i }).click();
    await page.locator('.insp-swatch[aria-label="Fill colour"]').evaluate((el) => {
      const bg = (el as HTMLElement).style.background;
      if (bg.includes('rgba(255, 0, 0')) {
        throw new Error('invalid hex corrupted the fill');
      }
    });
  });

  test('undo groups a slider drag into one step', async ({ page }) => {
    await createRect(page);
    await openFillPicker(page);
    const hexInput = page.getByRole('textbox', { name: 'Hex color' });
    await hexInput.click();
    await hexInput.fill('#ff8800');
    await hexInput.press('Enter');
    await waitForSwatchBackground(page, 'rgb(255, 136, 0)');

    // Drag the hue slider through several intermediate values — one
    // committed gesture, matching the transaction contract.
    const hue = page.locator('.color-slider--hue .insp-slider__track');
    const hueBox = await hue.boundingBox();
    if (!hueBox) throw new Error('Hue slider not found');
    const y = hueBox.y + hueBox.height / 2;
    await page.mouse.move(hueBox.x + hueBox.width * 0.35, y);
    await page.mouse.down();
    await page.mouse.move(hueBox.x + hueBox.width * 0.5, y, { steps: 5 });
    await page.mouse.up();
    await page.getByRole('button', { name: /^done$/i }).click();

    // Single undo restores the pre-drag color in one step.
    await page.keyboard.press('ControlOrMeta+z');
    await waitForSwatchBackground(page, 'rgb(255, 136, 0)');
  });

  test('recent colors are recorded and shown after a committed edit', async ({ page }) => {
    await createRect(page);
    await openFillPicker(page);
    const hexInput = page.getByRole('textbox', { name: 'Hex color' });
    await hexInput.click();
    await hexInput.fill('#123456');
    await hexInput.press('Enter');
    await page.getByRole('button', { name: /^done$/i }).click();

    // Reopen: Recent Colors section lists the committed color.
    await openFillPicker(page);
    const recent = page.locator('.swatch-palette__section-title', { hasText: 'Recent Colors' });
    await expect(recent).toBeVisible({ timeout: 5000 });
    const section = recent.locator('xpath=..');
    await expect(section.getByRole('option').first()).toHaveAttribute('aria-label', '#123456');
  });
});
