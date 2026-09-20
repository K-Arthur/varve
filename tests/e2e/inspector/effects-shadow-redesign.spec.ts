/**
 * Figma/Sketch-inspired redesign of the Layer Effects row and per-corner
 * radius quad. Before this pass, the effect row was a flat, bottom-bordered
 * strip of eight small icon buttons with a square color swatch and a
 * plain eye-icon visibility toggle; ShadowParams spread X/Y, Angle/Distance,
 * and Blur/Spread across three separate label/field pairs, "Distance"
 * truncated to "Distan" in the fixed label column, and Opacity showed a raw
 * 0-1 decimal instead of a percentage. Corner radius had the same
 * three-separate-pairs layout for TL/TR/BL/BR.
 *
 * This covers the structural, verifiable parts of that redesign: the row is
 * now a card, the visibility control is a real switch, the color swatch is
 * circular, the shadow quad is one boxed 2x2 grid with icon-prefixed fields
 * and no label truncation, opacity reads as a percentage, and the corner
 * radius quad uses the same boxed-grid treatment.
 */
import { expect, test } from '@playwright/test';
import { addLayerEffect, navigateToEditor } from '../shared';

async function drawRect(page: import('@playwright/test').Page) {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 5000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 280, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('v');
}

test.describe('Inspector — Effects/Shadow row and Corner Radius redesign', () => {
  test('effect row is a card with a switch, circular swatch, and boxed shadow quad', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await drawRect(page);

    const effectsHeading = page.getByRole('button', { name: 'Layer Effects' });
    await effectsHeading.scrollIntoViewIfNeeded();
    await effectsHeading.click();
    const effectsSection = page.locator('.insp-disclosure').filter({ hasText: 'Layer Effects' });
    await addLayerEffect(page, effectsSection, 'Drop Shadow');
    await page.waitForTimeout(200);

    const row = page.locator('.insp-effect-row').first();
    await expect(row).toBeVisible();

    // Card container, not a flat bottom-border-only strip.
    const rowStyle = await row.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderRadius: s.borderRadius, borderStyle: s.borderTopStyle };
    });
    expect(rowStyle.borderStyle).toBe('solid');
    expect(rowStyle.borderRadius).not.toBe('0px');

    // Visibility control is a real switch, defaulting on for a new effect.
    const visSwitch = row.getByRole('switch', { name: /hide effect/i });
    await expect(visSwitch).toBeVisible();
    await expect(visSwitch).toHaveAttribute('aria-checked', 'true');

    // Color swatch is circular.
    const swatch = row.locator('.insp-swatch--round').first();
    await expect(swatch).toBeVisible();
    const radius = await swatch.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).toBe('50%');

    // Shadow quad: X/Y/Blur/Spread grouped in one boxed grid with icons,
    // and "Distance" no longer truncates.
    const quad = page.locator('.insp-focused-editor .insp-quad-grid');
    await expect(quad).toBeVisible();
    await expect(quad.locator('.insp-icon-field')).toHaveCount(4);
    const distanceLabel = page.locator('.insp-focused-editor .insp-field__label', {
      hasText: 'Dist',
    });
    await expect(distanceLabel).toBeVisible();
    const distanceBox = await distanceLabel.boundingBox();
    expect(distanceBox).not.toBeNull();
    expect(distanceBox!.width).toBeGreaterThan(0);

    // Opacity reads as a percentage, not a raw 0-1 decimal (default new
    // dropShadow opacity is 0.3).
    const opacityInput = page.locator('.insp-focused-editor input[aria-label*="Opacity" i]');
    await expect(opacityInput).toHaveValue('30');
  });

  test('corner radius per-corner fields use the same boxed icon-quad', async ({ page }) => {
    await navigateToEditor(page);
    await drawRect(page);

    const cornerHeading = page.getByRole('button', { name: 'Corner Radius' });
    await cornerHeading.scrollIntoViewIfNeeded();
    await cornerHeading.click();
    await page.getByRole('button', { name: /edit individual corners/i }).click();
    await page.waitForTimeout(150);

    const quad = page.locator('.insp-quad-grid').first();
    await expect(quad).toBeVisible();
    const fields = quad.locator('.insp-icon-field');
    await expect(fields).toHaveCount(4);

    // The visible short labels stay visible, while each spinbutton keeps a
    // full, unit-suffixed accessible name ("Top left (px)") — the unit is part
    // of the name so screen readers never announce a bare, ambiguous number.
    for (const short of ['TL', 'TR', 'BL', 'BR']) {
      await expect(
        quad.locator('.insp-field__label', { hasText: new RegExp(`^${short}$`) }),
      ).toBeVisible();
    }
    await expect(quad.getByLabel('Top left (px)')).toBeVisible();
    await expect(quad.getByLabel('Top right (px)')).toBeVisible();
    await expect(quad.getByLabel('Bottom left (px)')).toBeVisible();
    await expect(quad.getByLabel('Bottom right (px)')).toBeVisible();
  });
});
