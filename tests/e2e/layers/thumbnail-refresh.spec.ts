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

  const opacity = page.getByRole('spinbutton', { name: /opacity/i }).first();
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
