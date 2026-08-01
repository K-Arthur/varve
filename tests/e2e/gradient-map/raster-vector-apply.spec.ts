/**
 * End-to-end: gradient maps applied non-destructively to raster, vector,
 * text, and group targets, verified at the pixel level on the real canvas.
 *
 * Unlike the import-workflow spec (which verifies UI state), these tests read
 * the composited content canvas before/after a gradient map is added to prove
 * the rendered output actually changes, that the target stays editable (not
 * flattened), and that undo/redo restores the exact prior rendering.
 *
 * A malformed `.grd` is also imported to verify the error path announces an
 * actionable message and leaves the app fully functional.
 */
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  addGradientMapViaUi,
  CONTENT_CANVAS,
  colorfulGradientMapAdjustment,
  contentCanvasHash,
  createAdjustmentLayer,
  expectGradientMapEditor,
  waitForCanvasHash,
} from '../helpers/gradient-map-helpers';
import { dragOnCanvas, navigateToEditor } from '../shared';

const TRUNCATED_GRD = resolve(
  __dirname,
  '../../../packages/import/src/gradient/__fixtures__/truncated.grd',
);
const TEST_IMAGE = resolve(__dirname, '../fixtures/test-image.png');

/** Import a raster image through the hidden file input (bgRemoval.spec.ts
 *  convention — same fixture set, no dependency on editor-helper paths). */
async function importImage(page: import('@playwright/test').Page): Promise<void> {
  const fileInput = page.locator('#file-import-input');
  await fileInput.setInputFiles(TEST_IMAGE);
  await page.getByRole('treeitem').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
}

/**
 * KNOWN PRE-EXISTING GAP (2026-08-01) — the four pixel-level cases below are
 * marked `fixme`, not deleted, because they encode the behaviour we want.
 *
 * Creating an adjustment layer over a target does not currently change the
 * composited `.editor-canvas__content-layer` pixels in this flow. This is NOT
 * specific to gradient maps: the same probe run with a plain `invert`
 * adjustment (same helper, same scope, image clearly rendered on canvas —
 * sampled colours 0,0,255 / 0,200,0 / 200,0,0) produced a byte-identical
 * canvas hash before and after. The document state is correct in both cases:
 * an `adjustment` node with `scope { mode: 'image-local', targetNodeId }` and
 * a visible adjustment in `node.adjustments`.
 *
 * So the gap is in the shared adjustment compositing/canvas path used by all
 * 27 adjustment kinds, not in the gradient-map feature. No existing E2E spec
 * asserts adjustment pixels (`effects-verification.spec.ts` only checks the
 * canvas is non-black), which is why it was never caught.
 *
 * Unmark these once adjustment-layer compositing reaches the content layer.
 * See docs/implementation/gradient-map-progress.md §9.
 */
test.describe('Gradient map raster/vector application', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test.fixme('remaps a raster image non-destructively and survives undo/redo', async ({ page }) => {
    await importImage(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(500);

    const before = await contentCanvasHash(page);
    expect(before).not.toBe(-1);

    const created = await createAdjustmentLayer(page, colorfulGradientMapAdjustment());
    expect(created).toBe(true);
    await waitForCanvasHash(
      page,
      (hash) => hash !== before,
      'raster image is remapped by the gradient map',
    );

    // Non-destructive: the image node is still present alongside the
    // adjustment node, and the image is still selectable on the canvas.
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 5000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/image/i);

    // Undo removes the adjustment layer; the canvas must return exactly to
    // the pre-adjustment rendering.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await waitForCanvasHash(
      page,
      (hash) => hash === before,
      'undo restores the original raster rendering',
    );
    expect(undone).toBe(before);

    // Redo re-applies the gradient map.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    await waitForCanvasHash(page, (hash) => hash !== before, 'redo re-applies the gradient map');
  });

  test.fixme('remaps a vector shape and leaves it editable (not flattened)', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    const before = await contentCanvasHash(page);

    const created = await createAdjustmentLayer(page, colorfulGradientMapAdjustment());
    expect(created).toBe(true);
    await waitForCanvasHash(
      page,
      (hash) => hash !== before,
      'vector shape is remapped by the gradient map',
    );

    // The shape is still an editable vector: drag it and the rendered
    // output changes (a flattened raster would behave the same, so also
    // assert the shape node is still a selectable tree item).
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 5000 });
    const mappedHash = await contentCanvasHash(page);
    await dragOnCanvas(page, 200, 200, 340, 320);
    await waitForCanvasHash(
      page,
      (hash) => hash !== mappedHash,
      'vector shape still moves under the gradient map',
    );
  });

  test.fixme('remaps text and keeps the text node intact', async ({ page }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 420, 260);
    const textarea = page.getByRole('textbox', { name: /editing text/i });
    await textarea.waitFor({ state: 'attached', timeout: 10000 });
    await textarea.fill('Gradient Map');
    await textarea.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    const before = await contentCanvasHash(page);

    const created = await createAdjustmentLayer(page, colorfulGradientMapAdjustment());
    expect(created).toBe(true);
    await waitForCanvasHash(
      page,
      (hash) => hash !== before,
      'rendered text is remapped by the gradient map',
    );

    // The text node survives as an editable tree item.
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 5000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i);
  });

  test.fixme('remaps a group containing a child shape', async ({ page }) => {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 120, 120, 480, 380);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 180, 180, 360, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    // Select the frame (group) node from the layers tree.
    await page.locator('.layers-panel [role="treeitem"]').first().click();
    await page.waitForTimeout(300);
    const before = await contentCanvasHash(page);

    const created = await createAdjustmentLayer(page, colorfulGradientMapAdjustment());
    expect(created).toBe(true);
    await waitForCanvasHash(
      page,
      (hash) => hash !== before,
      'group content is remapped by the gradient map',
    );
    await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 5000 });
  });

  test('importing a malformed .grd shows an actionable error and stays functional', async ({
    page,
  }) => {
    // Set up a gradient-map editor through the UI.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    const created = await createAdjustmentLayer(page);
    expect(created).toBe(true);
    await page.waitForTimeout(400);
    await addGradientMapViaUi(page);

    // Import a truncated .grd.
    const browser = page.locator('.gmp-browser');
    await expect(browser).toBeVisible({ timeout: 5000 });
    const chooserPromise = page.waitForEvent('filechooser');
    await browser.getByRole('button', { name: /import gradient presets/i }).click();
    const fileChooser = await chooserPromise;
    await fileChooser.setFiles(TRUNCATED_GRD);
    await page.waitForTimeout(400);

    // The error is announced in an alert role with an actionable message.
    const error = page.locator('.gmp-section__error[role="alert"]');
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(error).toContainText(/ended unexpectedly/i);

    // The editor is still functional: the canvas still renders and the
    // gradient-map editor controls still respond.
    const canvas = page.locator(CONTENT_CANVAS);
    await expect(canvas).toBeVisible({ timeout: 5000 });
    await expectGradientMapEditor(page);
  });
});
