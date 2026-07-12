import { expect, test } from '@playwright/test';

/**
 * Drives the real browser dev server (same entry as `pnpm dev` in
 * apps/desktop) with real pointer events — the class of bug this file
 * guards against (drag-to-create tools silently doing nothing) is
 * invisible to unit tests, which call tool methods directly instead of
 * going through actual PointerEvent dispatch + setPointerCapture.
 */

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Toolbar button's accessible name is "New" (icon + "New" text), not
  // "New file" — matching on the fuller phrase silently times out.
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });

  // A first-run "Welcome to Strata" modal can overlay the canvas. It has real
  // paragraph text, so a drag gesture starting on it becomes a text
  // selection instead of reaching the canvas underneath — silently eating
  // every tool's drag-to-create gesture. Dismiss it if present.
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

/** Drag on the canvas from (x1,y1) to (x2,y2) as discrete pointer events. */
async function dragOnCanvas(
  page: import('@playwright/test').Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  // Multiple intermediate moves — BaseTool only fires onDragStart/onDragMove
  // past a 3px CSS threshold, and a single jump can be coalesced by the OS.
  await page.mouse.move(box.x + (x1 + x2) / 2, box.y + (y1 + y2) / 2);
  await page.mouse.move(box.x + x2, box.y + y2);
  await page.mouse.up();
}

test.describe('Canvas drawing tools — drag-to-create', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Rectangle tool creates a rect node on drag', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/rect/i);
  });

  test('Ellipse tool creates an ellipse node on drag', async ({ page }) => {
    await page.keyboard.press('o');
    await dragOnCanvas(page, 150, 150, 350, 300);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/ellipse/i);
  });

  test('Frame tool creates a frame node on drag', async ({ page }) => {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 150, 150, 500, 450);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/frame/i);
  });

  test('drag-created rect is visibly painted on the content canvas (not just in the doc)', async ({
    page,
  }) => {
    // Regression guard for the rootChildren/activePage.contentRoot page-scoping
    // bug class: a node can exist in doc.nodes (and thus in the Layers panel)
    // while never being painted, because the canvas renderer walks
    // activePageNodes(doc), not doc.nodes directly.
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await contentCanvas.screenshot();

    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
    // Let the (possibly async-engine-backed) draw pass settle.
    await page.waitForTimeout(300);

    const after = await contentCanvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('shapes still paint exactly where dragged after panning far (floating-origin regression)', async ({
    page,
  }) => {
    test.setTimeout(120000);
    // Regression guard for a whole class of bugs found 2026-07-11: several
    // overlay components (text edit box, gradient/node-edit/mesh-warp
    // handles, alignment guides, ...) computed screen position as naive
    // `world*zoom+pan`, which coincidentally matches the canvas's real paint
    // transform (applyEditorCameraToCtx, which subtracts a floating origin)
    // ONLY while origin is [0,0] — i.e. only near world (0,0), which is
    // exactly where a fresh document starts and why this was invisible
    // until panning far enough for the floating origin to become non-zero.
    // Pan by more than FLOATING_ORIGIN_GRID (512 world units) so this test
    // actually exercises a non-zero origin.
    await page.keyboard.press('h');
    await dragOnCanvas(page, 400, 400, 400 - 900, 400 - 900);

    await page.keyboard.press('r');
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    // Compare only the clipped region we're about to draw into — proves the
    // shape rendered exactly at the drag coordinates, not just "somewhere".
    const clip = { x: 150, y: 150, width: 200, height: 150 };
    const before = await contentCanvas.screenshot({ clip });
    await page.waitForTimeout(500);
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(300);
    const after = await contentCanvas.screenshot({ clip });

    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('Text tool creates a visible text node on click', async ({ page }) => {
    // Text tool creates a text node at the click position on the canvas.
    // The text node is initially empty but should appear in the layers panel.
    await page.keyboard.press('t');
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await contentCanvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i);
  });
});
