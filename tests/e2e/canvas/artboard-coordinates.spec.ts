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
  let autoRevealWasEnabled = false;

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    const autoReveal = page.getByRole('button', {
      name: 'Auto-reveal canvas selection',
    });
    autoRevealWasEnabled = (await autoReveal.getAttribute('aria-pressed')) === 'true';
  });

  test.afterEach(async ({ page }) => {
    if (!autoRevealWasEnabled) return;
    const autoReveal = page.getByRole('button', {
      name: 'Auto-reveal canvas selection',
    });
    if ((await autoReveal.getAttribute('aria-pressed')) === 'false') await autoReveal.click();
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

  async function selectedOverlayBounds(page: import('@playwright/test').Page) {
    const selectionRect = page.locator('svg:has(filter#selection-glow) rect').first();
    await expect(selectionRect).toBeVisible();
    const bounds = await selectionRect.boundingBox();
    if (!bounds) throw new Error('selected object overlay has no screen bounds');
    return bounds;
  }

  async function dragAtScreen(
    page: import('@playwright/test').Page,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) {
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move((fromX + toX) / 2, (fromY + toY) / 2, { steps: 5 });
    await page.mouse.move(toX, toY, { steps: 5 });
    await page.mouse.up();
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
  }, testInfo) => {
    test.setTimeout(120000);
    // Use real screen geometry for setup. Artboard creation can change the
    // camera, so fixed canvas-origin coordinates can put a shape into a
    // different artboard even when the pointer gesture itself is valid.
    const autoReveal = page.getByRole('button', {
      name: 'Auto-reveal canvas selection',
    });
    if (autoRevealWasEnabled) await autoReveal.click();
    await expect(autoReveal).toHaveAttribute('aria-pressed', 'false');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas must have screen bounds before artboard creation');
    const frameWidth = Math.min(300, Math.floor((canvasBox.width - 65) / 2));
    const frameHeight = Math.min(220, Math.floor(canvasBox.height - 60));
    if (frameWidth < 160 || frameHeight < 120) {
      throw new Error(
        `canvas is too small for the two-artboard scenario: ${canvasBox.width}x${canvasBox.height}`,
      );
    }

    const frameARow = page.locator('[role="treeitem"][data-layer-type="frame"]', {
      hasText: 'Frame 1',
    });
    await page.keyboard.press('f');
    await dragAtScreen(
      page,
      canvasBox.x + 20,
      canvasBox.y + 30,
      canvasBox.x + 20 + frameWidth,
      canvasBox.y + 30 + frameHeight,
    );
    await page.keyboard.press('v');
    await frameARow.click();
    await expect(frameARow).toHaveAttribute('aria-selected', 'true');
    const frameABox = await selectedOverlayBounds(page);
    const frameAX = Number(await page.getByRole('spinbutton', { name: 'X (px)' }).inputValue());

    // Draw a real child inside A using A's current overlay bounds. This makes
    // its parent relationship independent of camera origin and zoom.
    await page.keyboard.press('r');
    await dragAtScreen(
      page,
      frameABox.x + frameABox.width * 0.2,
      frameABox.y + frameABox.height * 0.2,
      frameABox.x + frameABox.width * 0.58,
      frameABox.y + frameABox.height * 0.58,
    );

    // Place B beside A using the live on-screen frame bounds, then expand A
    // so selecting its child is independent of whichever frame is selected.
    const frameBLeft = frameABox.x + frameABox.width + 15;
    if (frameBLeft + frameWidth > canvasBox.x + canvasBox.width - 8) {
      throw new Error('canvas does not have room to place the second artboard beside the first');
    }
    await page.keyboard.press('f');
    await dragAtScreen(
      page,
      frameBLeft,
      frameABox.y,
      frameBLeft + frameWidth,
      frameABox.y + frameHeight,
    );
    await page.keyboard.press('v');

    const frame2Row = page.locator('[role="treeitem"][data-layer-type="frame"]', {
      hasText: 'Frame 2',
    });
    await frame2Row.click();
    await expect(frame2Row).toHaveAttribute('aria-selected', 'true');
    const frameBX = Number(await page.getByRole('spinbutton', { name: 'X (px)' }).inputValue());

    if ((await frameARow.getAttribute('aria-expanded')) === 'false') {
      await frameARow.getByRole('button', { name: 'Expand' }).click();
    }
    const childRow = page.locator('[role="treeitem"][data-layer-type="shape"]', {
      hasText: 'Rectangle 1',
    });
    await expect(childRow).toHaveCount(1);
    await expect(childRow).toHaveAttribute('aria-level', '2');

    // Fit both artboards before the move. From here, layer selection leaves
    // the camera stable and the drag uses the selected child's real screen
    // bounds.
    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await page.waitForTimeout(500);
    await childRow.click();
    await expect(childRow).toHaveAttribute('aria-selected', 'true');

    const childX = Number(await page.getByRole('spinbutton', { name: 'X (px)' }).inputValue());
    const childY = Number(await page.getByRole('spinbutton', { name: 'Y (px)' }).inputValue());
    const childBox = await selectedOverlayBounds(page);
    const childCenter = {
      x: childBox.x + childBox.width / 2,
      y: childBox.y + childBox.height / 2,
    };

    const zoomPercent = Number(await page.locator('#menubar-zoom').inputValue());
    const targetLocalX = childX + 50;
    const worldDelta = frameBX - frameAX + 50;
    const screenDelta = worldDelta * (zoomPercent / 100);
    const reparentTolerance = 8;
    // Move the child into B while preserving its pointer-driven world pose.
    // The destination is derived from the two live inspector positions, not
    // from assumed world coordinates.
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
    if ((await frame2Row.getAttribute('aria-expanded')) === 'false') {
      await frame2Row.getByRole('button', { name: 'Expand' }).click();
    }
    await childRow.click();

    // The child follows the pointer into B without a second jump during
    // reparenting; its B-local X advances by the intentional 50 world px.
    await readField(page, 'X', targetLocalX, reparentTolerance);
    await readField(page, 'Y', childY, 5);
    const afterDragBox = await selectedOverlayBounds(page);
    expect(afterDragBox.x).toBeGreaterThan(childBox.x + screenDelta - 6);
    expect(afterDragBox.x).toBeLessThan(childBox.x + screenDelta + 6);
    await testInfo.attach('child-after-cross-artboard-drag', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // Undo restores the original parent-local coordinates and screen pose.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    await childRow.click();
    await readField(page, 'X', childX, 4);
    const afterUndoBox = await selectedOverlayBounds(page);
    expect(afterUndoBox.x).toBeGreaterThan(childBox.x - 4);
    expect(afterUndoBox.x).toBeLessThan(childBox.x + 4);

    // Redo restores the destination parent and the same moved screen pose.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(600);
    if ((await frame2Row.getAttribute('aria-expanded')) === 'false') {
      await frame2Row.getByRole('button', { name: 'Expand' }).click();
    }
    await childRow.click();
    await readField(page, 'X', targetLocalX, reparentTolerance);
    const afterRedoBox = await selectedOverlayBounds(page);
    expect(afterRedoBox.x).toBeGreaterThan(afterDragBox.x - 4);
    expect(afterRedoBox.x).toBeLessThan(afterDragBox.x + 4);
    await testInfo.attach('child-after-cross-artboard-redo', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
