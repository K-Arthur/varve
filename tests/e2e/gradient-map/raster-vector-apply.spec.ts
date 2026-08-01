/**
 * End-to-end: gradient maps applied non-destructively to raster, vector,
 * text, and group targets, verified at the pixel level on the real canvas.
 *
 * Unlike the import-workflow spec (which verifies UI state), these tests read
 * the composited content canvas before/after a gradient map is added to prove
 * the rendered output actually changes, that the target stays editable (not
 * flattened), and that undo/redo adds and removes the effect. Undo is checked
 * against the document model plus "no longer the mapped rendering" rather than
 * exact canvas-hash equality — see the note on the undo assertion below.
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
  documentNodeKinds,
  expectGradientMapEditor,
  navigateToEditorWithRetry,
  waitForCanvasHash,
  waitForStableCanvasHash,
} from '../helpers/gradient-map-helpers';
import { dragOnCanvas } from '../shared';

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
 * Root-cause note (2026-08-01): the four pixel-level cases below were
 * originally marked `fixme` because adding an adjustment layer did not change
 * the composited `.editor-canvas__content-layer` pixels. The cause was in
 * `context.tsx` `createAdjustmentLayer`: it appended the new node to
 * `doc.rootChildren`, while the renderer walks the active page's `contentRoot`
 * (every other creator, e.g. `createShapeAt`, parents into it). An adjustment
 * node hanging off `rootChildren` had a correct document model but was outside
 * the rendered subtree. Fixed by parenting adjustment layers to the active
 * page content root. These tests assert the actual pixels, so they are the
 * regression guard for that fix.
 */
test.describe('Gradient map raster/vector application', () => {
  // 300s. A cold Vite dev graph can take over a minute to parse in-browser
  // before the editor is interactive, which does not fit the 60s default, and
  // `navigateToEditorWithRetry` budgets one prime plus up to three attempts on
  // top of that. This is a dev-server startup allowance only — it does not
  // relax any assertion, each of which keeps its own short timeout.
  test.describe.configure({ mode: 'serial', timeout: 300_000 });
  test.beforeEach(async ({ page }) => {
    await navigateToEditorWithRetry(page);
  });

  test('remaps a raster image non-destructively and survives undo/redo', async ({ page }) => {
    await importImage(page);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(500);

    const before = await waitForStableCanvasHash(page, 'raster image rendered and settled');
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
    // Non-destructive: the image layer still exists. Assert by identity, not
    // tree position — the adjustment layer is painted above the image, so it
    // legitimately sorts first in the layers tree.
    await expect(page.getByRole('treeitem').filter({ hasText: /image/i })).toHaveCount(1);

    const mapped = await waitForStableCanvasHash(page, 'gradient map settled');
    expect(await documentNodeKinds(page)).toContain('adjustment');

    // Undo drops the adjustment layer: the document loses the adjustment node
    // and the canvas stops showing the mapped rendering.
    //
    // Deliberately NOT asserting `hash === before`. Removing the layer changes
    // the selection, and the inspector's content is selection-dependent, so
    // the canvas element itself resizes (measured: 682x494 -> 682x516) and the
    // camera shifts. Two visually-correct states therefore hash differently,
    // which makes exact-hash equality a test of incidental view state rather
    // than of undo. The document assertion below is the stronger check.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await waitForCanvasHash(
      page,
      (hash) => hash !== mapped,
      'undo removes the gradient-mapped rendering',
    );
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
    expect(await documentNodeKinds(page)).not.toContain('adjustment');

    // Redo re-applies the gradient map.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 5000 });
    expect(await documentNodeKinds(page)).toContain('adjustment');
  });

  test('remaps a vector shape and leaves it editable (not flattened)', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(300);

    const before = await waitForStableCanvasHash(page, 'content rendered and settled');

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

  test('remaps text and keeps the text node intact', async ({ page }) => {
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

    const before = await waitForStableCanvasHash(page, 'content rendered and settled');

    const created = await createAdjustmentLayer(page, colorfulGradientMapAdjustment());
    expect(created).toBe(true);
    await waitForCanvasHash(
      page,
      (hash) => hash !== before,
      'rendered text is remapped by the gradient map',
    );

    // The text node survives as an editable tree item (assert by identity,
    // not tree position — the adjustment layer sorts above it).
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 5000 });
    await expect(page.getByRole('treeitem').filter({ hasText: /text/i })).toHaveCount(1);
  });

  test('remaps a group containing a child shape', async ({ page }) => {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 120, 120, 480, 380);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 180, 180, 360, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    // Select the frame (group) node from the layers tree.
    await page.locator('.layers-panel [role="treeitem"]').first().click();
    await page.waitForTimeout(300);
    const before = await waitForStableCanvasHash(page, 'content rendered and settled');

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
