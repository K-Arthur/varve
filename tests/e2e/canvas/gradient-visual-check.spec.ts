import { test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

test('hue slider interactive', async ({ page }) => {
  await navigateToCleanEditor(page);
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 350);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 300, box.y + 250);
  await page.waitForTimeout(500);

  // Switch to Gradient
  const ft = page.getByRole('combobox', { name: /fill type/i });
  if (await ft.isVisible({ timeout: 3000 }).catch(() => false)) {
    await ft.click();
    await page.waitForTimeout(200);
    await page.getByRole('option', { name: /^Gradient$/i }).click();
    await page.waitForTimeout(500);
  }

  // Scroll to color picker
  const gradEditor = page.locator('.gradient-editor');
  if (await gradEditor.isVisible({ timeout: 3000 }).catch(() => false)) {
    await gradEditor.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }

  // Screenshot before clicking hue slider
  await page.screenshot({ path: 'test-results/hue-before.png', fullPage: false });

  // Find the hue slider thumb and drag it
  const hueThumb = page.locator('.color-picker__sliders .insp-slider__thumb').first();
  if (await hueThumb.isVisible({ timeout: 3000 }).catch(() => false)) {
    const thumbBox = await hueThumb.boundingBox();
    if (thumbBox) {
      // Click near the right side of the hue slider (towards red/yellow)
      const track = page.locator('.color-picker__sliders .insp-slider__track').first();
      const trackBox = await track.boundingBox();
      if (trackBox) {
        // Click at 75% of the track (yellow/green area)
        await page.mouse.click(
          trackBox.x + trackBox.width * 0.75,
          trackBox.y + trackBox.height / 2,
        );
        await page.waitForTimeout(500);
      }
    }
  }

  // Screenshot after changing hue
  await page.screenshot({ path: 'test-results/hue-after.png', fullPage: false });
  console.log('Hue slider interaction complete');
});
