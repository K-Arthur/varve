import { expect, test } from '@playwright/test';
import { importImageFile } from '../helpers/editor-helpers';
import { navigateToEditor } from '../shared';

/**
 * Layer thumbnail freshness.
 *
 * Thumbnail cache keys must include every property the thumbnail renderer
 * draws. Stroke, opacity, rotation, and corner radius were missing, and the
 * invalidation bridge that was supposed to cover them matched the wrong key
 * shape (`nodeId:` while real keys are `docId:nodeId:`), so an appearance edit
 * kept the old thumbnail until LRU eviction. This drives the real UI: import a
 * photograph, change layer opacity, and require the row's thumbnail image to
 * re-render.
 */
test('an image layer thumbnail refreshes after an appearance edit', async ({ page }) => {
  await navigateToEditor(page);
  await importImageFile(page, 'photo-fixture.jpg');

  const imageRow = page
    .getByRole('treeitem')
    .filter({ has: page.locator('.layers-row__thumbnail') })
    .first();
  const thumbnail = imageRow.locator('.layers-row__thumbnail');
  await expect(thumbnail).toBeVisible();

  const before = await thumbnail.getAttribute('src');
  expect(before).toBeTruthy();

  const opacity = page
    .getByRole('group', { name: 'Appearance', exact: true })
    .getByRole('spinbutton', { name: 'Opacity (%)', exact: true });
  await expect(opacity).toBeVisible();
  await opacity.click();
  await opacity.fill('40');
  await opacity.press('Enter');

  await expect
    .poll(async () => thumbnail.getAttribute('src'), {
      timeout: 10000,
      message: 'thumbnail should be regenerated after the opacity change',
    })
    .not.toBe(before);
});

/** The fill and layer own different alpha values; changing either must show in the row preview. */
test('an image thumbnail follows fill alpha while layer opacity stays unchanged', async ({
  page,
}) => {
  await navigateToEditor(page);
  await importImageFile(page, 'photo-fixture.jpg');
  const imageRow = page
    .getByRole('treeitem')
    .filter({ has: page.locator('.layers-row__thumbnail') })
    .first();
  const thumbnail = imageRow.locator('.layers-row__thumbnail');
  await expect(thumbnail).toBeVisible();
  await imageRow.click();
  const fillOpacity = page
    .getByRole('group', { name: 'Fill', exact: true })
    .getByRole('spinbutton', { name: 'Fill opacity (%)', exact: true });
  const layerOpacity = page
    .getByRole('group', { name: 'Appearance', exact: true })
    .getByRole('spinbutton', { name: 'Opacity (%)', exact: true });
  await expect(layerOpacity).toHaveValue('100');
  const readAlpha = async () =>
    thumbnail.evaluate(async (element: HTMLImageElement) => {
      const image = new Image();
      image.src = element.src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('thumbnail alpha surface is unavailable');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let alpha = 0;
      let paintedPixels = 0;
      for (let index = 3; index < data.length; index += 4) {
        alpha += data[index]!;
        if (data[index]! > 0) paintedPixels++;
      }
      return { alpha, paintedPixels, width: canvas.width, height: canvas.height };
    });
  const opaque = await readAlpha();
  expect(opaque.alpha).toBeGreaterThan(0);
  const originalSource = await thumbnail.getAttribute('src');
  await fillOpacity.fill('50');
  await fillOpacity.press('Enter');
  await expect.poll(() => thumbnail.getAttribute('src')).not.toBe(originalSource);
  const half = await readAlpha();
  expect(half.width).toBe(opaque.width);
  expect(half.height).toBe(opaque.height);
  // RGBA8 rounds each half-alpha channel by at most half a unit.
  expect(Math.abs(half.alpha - opaque.alpha / 2)).toBeLessThanOrEqual(opaque.paintedPixels / 2);
  await expect(layerOpacity).toHaveValue('100');
  await fillOpacity.fill('0');
  await fillOpacity.press('Enter');
  await expect.poll(async () => (await readAlpha()).alpha).toBe(0);
  await expect(layerOpacity).toHaveValue('100');
  await fillOpacity.fill('100');
  await fillOpacity.press('Enter');
  await expect.poll(async () => (await readAlpha()).alpha).toBe(opaque.alpha);
  await expect(layerOpacity).toHaveValue('100');
});
