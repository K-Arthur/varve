import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO_FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const LUT_FIXTURES = path.resolve(__dirname, 'fixtures');

test('LUT changes real photo colors — nature photograph', async ({ page }) => {
  await navigateToEditor(page);

  // Import a real photo onto the canvas
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#file-import-input').evaluate((el: HTMLInputElement) => el.click()),
  ]);
  await fileChooser.setFiles(path.join(PHOTO_FIXTURES, 'photo-fixture.jpg'));
  await page.waitForTimeout(3000);

  // Screenshot BEFORE LUT
  await page.screenshot({ path: path.join(PHOTO_FIXTURES, 'photo-before-lut.png') });

  // Read pixel color from the center of the imported image
  const colorBefore = await page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Sample a 10x10 area and average
    const size = 10;
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const data = ctx.getImageData(cx - size / 2, cy - size / 2, size, size).data;
    let r = 0,
      g = 0,
      b = 0,
      count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 0) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        count++;
      }
    }
    return count > 0
      ? { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) }
      : null;
  });
  console.log('BEFORE LUT — avg color:', colorBefore);

  // Import the warm-look LUT
  const [fileChooser2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#file-import-input').evaluate((el: HTMLInputElement) => el.click()),
  ]);
  await fileChooser2.setFiles(path.join(LUT_FIXTURES, 'warm-look.cube'));
  await page.waitForTimeout(3000);

  // Verify layer was created
  const layersText = await page.locator('[data-panel="layers"]').textContent();
  expect(layersText).toContain('LUT');

  // Screenshot AFTER LUT
  await page.screenshot({ path: path.join(PHOTO_FIXTURES, 'photo-after-lut.png') });

  // Read pixel color from the same position
  const colorAfter = await page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const size = 10;
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const data = ctx.getImageData(cx - size / 2, cy - size / 2, size, size).data;
    let r = 0,
      g = 0,
      b = 0,
      count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 0) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        count++;
      }
    }
    return count > 0
      ? { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) }
      : null;
  });
  console.log('AFTER LUT — avg color:', colorAfter);

  // The LUT MUST change the colors
  expect(colorBefore).toBeTruthy();
  expect(colorAfter).toBeTruthy();

  const diff = {
    r: Math.abs(colorAfter!.r - colorBefore!.r),
    g: Math.abs(colorAfter!.g - colorBefore!.g),
    b: Math.abs(colorAfter!.b - colorBefore!.b),
  };
  console.log('Color difference:', diff);

  // At least one channel must change by more than 2 (accounting for rendering precision)
  const totalDiff = diff.r + diff.g + diff.b;
  expect(totalDiff).toBeGreaterThan(2);
});

test('LUT changes real photo colors — portrait', async ({ page }) => {
  await navigateToEditor(page);

  // Import a real portrait photo
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#file-import-input').evaluate((el: HTMLInputElement) => el.click()),
  ]);
  await fileChooser.setFiles(path.join(PHOTO_FIXTURES, 'subject-photo.png'));
  await page.waitForTimeout(3000);

  // Read pixel from face area (center of image)
  const colorBefore = await page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const size = 10;
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const data = ctx.getImageData(cx - size / 2, cy - size / 2, size, size).data;
    let r = 0,
      g = 0,
      b = 0,
      count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 0) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        count++;
      }
    }
    return count > 0
      ? { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) }
      : null;
  });
  console.log('Portrait BEFORE LUT:', colorBefore);

  // Apply warm-look LUT
  const [fileChooser2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#file-import-input').evaluate((el: HTMLInputElement) => el.click()),
  ]);
  await fileChooser2.setFiles(path.join(LUT_FIXTURES, 'warm-look.cube'));
  await page.waitForTimeout(3000);

  const colorAfter = await page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const size = 10;
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const data = ctx.getImageData(cx - size / 2, cy - size / 2, size, size).data;
    let r = 0,
      g = 0,
      b = 0,
      count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 0) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        count++;
      }
    }
    return count > 0
      ? { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) }
      : null;
  });
  console.log('Portrait AFTER LUT:', colorAfter);

  const diff = {
    r: Math.abs(colorAfter!.r - colorBefore!.r),
    g: Math.abs(colorAfter!.g - colorBefore!.g),
    b: Math.abs(colorAfter!.b - colorBefore!.b),
  };
  console.log('Portrait color difference:', diff);

  const totalDiff = diff.r + diff.g + diff.b;
  expect(totalDiff).toBeGreaterThan(2);
});
