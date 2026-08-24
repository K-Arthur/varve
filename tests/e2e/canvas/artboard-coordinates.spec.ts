/**
 * Artboard-local coordinate space E2E.
 *
 * Verifies the parent-local coordinate contract through real pointer
 * interaction:
 *   - a child's stored local X/Y is artboard-relative and survives artboard
 *     movement (children never get rewritten)
 *   - the frame+child move together: clicking the child's NEW world
 *     position selects the child (topmost hit) at its unchanged
 *     artboard-local X/Y; clicking frame fill selects the frame at its new
 *     world placement
 *   - cross-artboard drag reparents without visual teleport (world pose
 *     preserved; local X/Y becomes destination-artboard-relative)
 *   - undo/redo of the reparent keeps the world pose stable
 *
 * Conventions follow the existing canvas specs (constraints, deep-selection):
 * canvas-relative drags assume the fresh-design camera, Ctrl+click is used
 * when selecting a child through its containing frame, and inspector X/Y
 * fields are the numeric authority for stored coordinates.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Artboard-local coordinates', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function plainClick(
    page: import('@playwright/test').Page,
    box: { x: number; y: number },
    worldX: number,
    worldY: number,
  ) {
    await page.mouse.click(box.x + worldX, box.y + worldY);
    await page.waitForTimeout(350);
  }

  async function deepClick(
    page: import('@playwright/test').Page,
    box: { x: number; y: number },
    worldX: number,
    worldY: number,
  ) {
    await page.keyboard.down('Control');
    await page.mouse.click(box.x + worldX, box.y + worldY);
    await page.keyboard.up('Control');
    await page.waitForTimeout(350);
  }

  async function readField(
    page: import('@playwright/test').Page,
    label: string,
    expected: number,
    tolerance = 2,
  ) {
    const field = page.getByRole('spinbutton', { name: `${label} (px)` });
    await expect(field).toBeVisible({ timeout: 5000 });
    // expect.poll retries on rejection, so a React re-render swapping the
    // input mid-read is retried instead of racing the selection transition.
    await expect
      .poll(async () => Number(await field.inputValue()), { timeout: 5000 })
      .toBeGreaterThan(expected - tolerance);
    await expect
      .poll(async () => Number(await field.inputValue()), { timeout: 5000 })
      .toBeLessThan(expected + tolerance);
    return Number(await field.inputValue());
  }

  test('child local X/Y is artboard-relative and survives artboard move', async ({ page }) => {
    test.setTimeout(120000);
    // Artboard at world (50,50) 400x300.
    await page.keyboard.press('f');
    const box = await dragOnCanvas(page, 50, 50, 450, 350);
    // Child rect at artboard-local (60,60)-(200,150).
    await page.keyboard.press('r');
    await dragOnCanvas(page, 110, 110, 250, 200);

    await page.keyboard.press('v');
    await page.waitForTimeout(300);
    // Select through the canvas so the layer-panel reveal-to-fit behavior does
    // not change the camera and invalidate the cached canvas bounding box.
    await deepClick(page, box, 150, 150);

    // Drawn at local (60,60): inspector shows artboard-relative values.
    const xBefore = await readField(page, 'X', 60);
    const yBefore = await readField(page, 'Y', 60);

    // Move the artboard by dragging its fill at world (80,80) — inside the
    // frame, outside the child — by (+250, +200).
    await plainClick(page, box, 80, 80);
    await page.mouse.move(box.x + 80, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 205, box.y + 80, { steps: 6 });
    await page.mouse.move(box.x + 330, box.y + 280, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    // The frame+child moved together: clicking the child's NEW world
    // position (360,310)-(500,400) selects the CHILD (topmost hit) and its
    // stored local X/Y is unchanged — children are never rewritten by a
    // parent move.
    await deepClick(page, box, 420, 350);
    await readField(page, 'X', xBefore);
    await readField(page, 'Y', yBefore);

    // Clicking the frame's fill (now world 300,250..700,550, outside the
    // child) selects the frame at its new placement. The drag's grab point
    // sits a few px off the frame origin, so tolerance is generous.
    await plainClick(page, box, 330, 280);
    await readField(page, 'X', 300, 8); // 50 + 250
    await readField(page, 'Y', 250, 8); // 50 + 200
  });

  test('cross-artboard drag reparents without teleport; undo/redo keeps world pose', async ({
    page,
  }) => {
    test.setTimeout(120000);
    // Artboard A at world (50,50) 400x300; Artboard B at (500,50) 400x300.
    await page.keyboard.press('f');
    await dragOnCanvas(page, 50, 50, 450, 350);

    // Child inside A at local (60,60) — world (110,110).
    await page.keyboard.press('r');
    await dragOnCanvas(page, 110, 110, 250, 200);

    // Create B only after the child is attached to A. Creating another
    // artboard can recalculate the view, so creating the child afterwards
    // from the old canvas box would place it outside A.
    await page.keyboard.press('f');
    await dragOnCanvas(page, 500, 50, 900, 350);

    await page.keyboard.press('v');
    await page.waitForTimeout(300);
    // Both artboards must be visible for the cross-artboard gesture. Fit all
    // also gives us the current zoom so the 500-world-pixel move can be
    // converted to its screen-space equivalent.
    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await page.waitForTimeout(500);

    // Selection reveal is intentionally disabled here. Selecting the child
    // through the layer tree gives us its actual post-layout screen bounds;
    // the drag below then uses those bounds rather than assuming the camera
    // stayed at its creation-time origin.
    const autoRevealBtn = page.getByRole('button', {
      name: 'Auto-reveal canvas selection',
    });
    await autoRevealBtn.click();
    await expect(autoRevealBtn).toHaveAttribute('aria-pressed', 'false');
    const frame2Row = page.locator('[role="treeitem"][data-layer-type="frame"]', {
      hasText: 'Frame 2',
    });
    const childRow = page.locator('[role="treeitem"][data-layer-type="shape"]', {
      hasText: 'Rectangle 1',
    });
    await expect(childRow).toHaveCount(1);
    // Start from the frame selected by the frame tool and use the tree's
    // arrow navigation. This follows the keyboard selection path without the
    // row-pointer handler's revealSelection (fit-to-node) camera change.
    await frame2Row.focus();
    await expect(frame2Row).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(350);
    await expect(childRow).toHaveAttribute('aria-selected', 'true');

    const selectionRect = page.locator('svg:has(filter#selection-glow) rect').first();
    const childBox = await selectionRect.boundingBox();
    if (!childBox) throw new Error('selected child overlay not found');
    const childCenter = {
      x: childBox.x + childBox.width / 2,
      y: childBox.y + childBox.height / 2,
    };
    await readField(page, 'X', 60);

    const zoomPercent = Number(await page.locator('#menubar-zoom').inputValue());
    const screenDelta = 500 * (zoomPercent / 100);
    // A browser pointer stream quantizes the fractional screen delta to CSS
    // pixels. At a fit-all zoom that can account for several world pixels,
    // while a reparent teleport would be hundreds; keep the assertion tight
    // enough to distinguish the two.
    const reparentTolerance = 8;
    // Drag the child 500 world px right into artboard B. Deriving the start
    // from the overlay keeps the test correct if the viewport origin is
    // fractional, while the zoom conversion keeps the world delta exact.
    // The hit tester normally resolves a click inside a frame to the frame.
    // Hold Ctrl only for pointer-down to resolve the child, then release it
    // before movement so SelectTool's normal drag-end auto-reparent path is
    // still active.
    await page.keyboard.down('Control');
    await page.mouse.move(childCenter.x, childCenter.y);
    await page.mouse.down();
    await page.keyboard.up('Control');
    await page.mouse.move(childCenter.x + screenDelta / 2, childCenter.y, { steps: 5 });
    await page.mouse.move(childCenter.x + screenDelta, childCenter.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    // The child follows the pointer by roughly +500 world px and is then
    // reparented into B without an additional teleport. Its world X is now
    // about 610, so its B-local X remains about 110 (not a second jump to the
    // destination frame's origin).
    await readField(page, 'X', 110, reparentTolerance);
    await readField(page, 'Y', 60, 5);

    // Undo the reparent: back in A at local (60,60).
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    // The history operation can restore the prior primary selection. The
    // camera no longer matters after the drag, so use the row directly to
    // make the restored child authoritative in the inspector.
    await childRow.click();
    await page.waitForTimeout(350);
    await readField(page, 'X', 60);

    // Redo: back in B at (110, 60) — the world pose survived the cycle.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(600);
    await childRow.click();
    await page.waitForTimeout(350);
    await readField(page, 'X', 110, reparentTolerance);
  });
});
