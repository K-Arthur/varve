/**
 * Real-world E2E scenarios for the redesigned Layer Effects section and popovers.
 *
 * Scenarios tested:
 * 1. UI Card Elevation Workflow:
 *    - Adding a drop shadow to a card component.
 *    - Applying an Elevation Preset (Raised / E3) and asserting quad values (Y=10, Blur=20, Spread=-3, Opacity=18%).
 *    - Live 2D Light Pad interaction updating angle/distance and Cartesian coordinates.
 *    - Validating opaque, solid popover (strict no-glassmorphism rule).
 * 2. In-Row Quick Blur Workflow (solving competitor popover friction):
 *    - Adding a Layer Blur.
 *    - Directly scrubbing/typing blur radius in the row input without opening any modal or popover.
 *    - Opening blur popover and selecting a quick preset chip (e.g. 48px).
 * 3. Multi-Effect Composition & Visibility Toggle:
 *    - Composing shadow and blur on a single layer.
 *    - Toggling visibility switch on/off.
 * 4. Visual Evidence Capture:
 *    - Capturing screenshots of the redesigned inspector panel, elevation presets, and light pad.
 */
import { expect, test } from '@playwright/test';
import { addLayerEffect, navigateToEditor } from '../shared';

async function drawCard(page: import('@playwright/test').Page) {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 5000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 340, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('v');
}

test.describe('Inspector — Real-World Layer Effects Workflows', () => {
  test('scenario 1: UI card elevation presets, 2D light pad, and solid opaque popover', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await drawCard(page);

    // Expand Layer Effects section
    const effectsHeading = page.getByRole('button', { name: 'Layer Effects' });
    await effectsHeading.scrollIntoViewIfNeeded();
    await effectsHeading.click();
    const effectsSection = page.locator('.insp-disclosure').filter({ hasText: 'Layer Effects' });

    // Add default drop shadow
    await addLayerEffect(page, effectsSection, 'Drop Shadow');
    await page.waitForTimeout(200);

    const row = page.locator('.insp-effect-row').first();
    await expect(row).toBeVisible();

    // Verify visibility switch
    const visSwitch = row.getByRole('switch', { name: /hide effect/i });
    await expect(visSwitch).toBeVisible();
    await expect(visSwitch).toHaveAttribute('aria-checked', 'true');

    // Open configuration popover if not already open. The row exposes one
    // disclosure trigger — the duplicate per-row Configure button was removed
    // in the clutter pass.
    const configBtn = row.locator('.insp-disclosure__trigger');
    const popover = page.locator('.insp-focused-editor');
    if (!(await popover.isVisible())) {
      await configBtn.click();
      await page.waitForTimeout(200);
    }
    await expect(popover).toBeVisible();

    // Verify strict NO-GLASSMORPHISM policy: solid surface overlay, zero backdrop-filter blur
    const popoverStyle = await popover.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        backdropFilter: s.backdropFilter,
        webkitBackdropFilter: (s as any).webkitBackdropFilter,
        backgroundColor: s.backgroundColor,
      };
    });
    expect(
      popoverStyle.backdropFilter === 'none' ||
        popoverStyle.backdropFilter === '' ||
        !popoverStyle.backdropFilter,
    ).toBe(true);

    // Verify Elevation Presets are present and clickable
    const elevationGroup = page.locator('.insp-elevation-presets');
    await expect(elevationGroup).toBeVisible();

    const raisedPreset = page.getByRole('button', { name: /Raised/i });
    await expect(raisedPreset).toBeVisible();
    await raisedPreset.click();
    await page.waitForTimeout(150);

    // Verify quad grid inputs updated to Elevation 3 (Raised: Y=10, Blur=20, Spread=-3, Opacity=18%)
    const yInput = page.locator('.insp-focused-editor input[aria-label="Y"]');
    await expect(yInput).toHaveValue('10');

    const blurInput = page.locator('.insp-focused-editor input[aria-label="Blur"]');
    await expect(blurInput).toHaveValue('20');

    const spreadInput = page.locator('.insp-focused-editor input[aria-label="Spread"]');
    await expect(spreadInput).toHaveValue('-3');

    const opacityInput = page.locator('.insp-focused-editor input[aria-label*="Opacity" i]');
    await expect(opacityInput).toHaveValue('18');

    // Verify live 2D Light Pad
    const lightPad = page.locator('.insp-light-pad');
    await expect(lightPad).toBeVisible();

    // Interact with 2D light pad
    const padBox = await lightPad.boundingBox();
    expect(padBox).not.toBeNull();
    if (padBox) {
      // Click at the top-right quadrant (around 45 degrees)
      await page.mouse.click(padBox.x + padBox.width * 0.8, padBox.y + padBox.height * 0.2);
      await page.waitForTimeout(150);

      // Verify that X offset and Y offset updated accordingly
      const newX = await page.locator('.insp-focused-editor input[aria-label="X"]').inputValue();
      const newY = await page.locator('.insp-focused-editor input[aria-label="Y"]').inputValue();
      expect(Number(newX)).not.toBe(0);
      expect(Number(newY)).not.toBe(0);
    }

    // Verify live preview tile is rendered
    const previewTile = page.locator('.insp-preview-tile');
    await expect(previewTile).toBeVisible();

    // Capture visual screenshot of the Shadow Studio Popover
    await page.screenshot({
      path: 'docs/screenshots/effects-redesign/shadow-studio-popover.png',
      fullPage: false,
    });
  });

  test('scenario 2: in-row direct blur radius modification and quick preset chips', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await drawCard(page);

    // Expand Layer Effects section
    const effectsHeading = page.getByRole('button', { name: 'Layer Effects' });
    await effectsHeading.scrollIntoViewIfNeeded();
    await effectsHeading.click();
    const effectsSection = page.locator('.insp-disclosure').filter({ hasText: 'Layer Effects' });

    // Pick 'Layer Blur' from the effect picker — choosing the type adds it.
    await addLayerEffect(page, effectsSection, 'Layer Blur');
    await page.waitForTimeout(200);

    const blurRow = page.locator('.insp-effect-row').first();
    await expect(blurRow).toBeVisible();

    // Verify in-row quick blur radius input exists directly on the row
    const inRowInput = blurRow.locator('.insp-inrow-blur__input');
    await expect(inRowInput).toBeVisible();

    // Test direct modification without opening popover (solving competitor friction!)
    await inRowInput.click();
    await inRowInput.fill('24');
    await inRowInput.press('Enter');
    await page.waitForTimeout(150);

    await expect(inRowInput).toHaveValue('24');

    // Now open the configure popover to inspect quick preset chips. A freshly
    // added effect row mounts expanded, so only toggle when it is closed.
    const configBtn = blurRow.locator('.insp-disclosure__trigger');
    const popover = page.locator('.insp-focused-editor');
    if (!(await popover.isVisible())) {
      await configBtn.click();
      await page.waitForTimeout(200);
    }
    await expect(popover).toBeVisible();

    // Verify preset chips are rendered (2, 4, 8, 16, 24, 48, 64)
    const chipsContainer = page.locator('.insp-radius-chips');
    await expect(chipsContainer).toBeVisible();

    const chip48 = chipsContainer.getByRole('button', { name: '48px' });
    await expect(chip48).toBeVisible();
    await chip48.click();
    await page.waitForTimeout(150);

    // In-row input and popover input should now reflect 48
    await expect(inRowInput).toHaveValue('48');

    // Capture visual screenshot of the Blur Studio Popover with chips
    await page.screenshot({
      path: 'docs/screenshots/effects-redesign/blur-studio-popover.png',
      fullPage: false,
    });
  });

  test('scenario 3: multi-effect composition and visibility toggling', async ({ page }) => {
    await navigateToEditor(page);
    await drawCard(page);

    const effectsHeading = page.getByRole('button', { name: 'Layer Effects' });
    await effectsHeading.scrollIntoViewIfNeeded();
    await effectsHeading.click();
    const effectsSection = page.locator('.insp-disclosure').filter({ hasText: 'Layer Effects' });

    // Add default drop shadow, then layer blur — each picker choice adds.
    await addLayerEffect(page, effectsSection, 'Drop Shadow');
    await page.waitForTimeout(200);

    await addLayerEffect(page, effectsSection, 'Layer Blur');
    await page.waitForTimeout(200);

    // Verify 2 effect rows are present
    const rows = page.locator('.insp-effect-row');
    await expect(rows).toHaveCount(2);

    // Toggle visibility switch on first row
    const firstSwitch = rows.first().getByRole('switch');
    await expect(firstSwitch).toHaveAttribute('aria-checked', 'true');
    await firstSwitch.click();
    await page.waitForTimeout(150);
    await expect(firstSwitch).toHaveAttribute('aria-checked', 'false');

    // Toggle it back on
    await firstSwitch.click();
    await page.waitForTimeout(150);
    await expect(firstSwitch).toHaveAttribute('aria-checked', 'true');

    // Capture visual screenshot of multiple effects composition
    await page.screenshot({
      path: 'docs/screenshots/effects-redesign/multi-effects-composition.png',
      fullPage: false,
    });
  });
});
