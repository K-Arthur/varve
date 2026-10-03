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
 * world positions are projected with the live camera before each gesture,
 * Ctrl+click is used
 * when selecting a child through its containing frame, and inspector X/Y
 * fields are the numeric authority for stored coordinates.
 */
import { expect, test } from '@playwright/test';
import { worldToScreen } from '@varve/shared';
import { navigateToEditor } from '../shared';

test.describe('Artboard-local coordinates', () => {
  test.describe.configure({ mode: 'serial' });
  let autoRevealWasEnabled = false;

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, '/?perf=1');
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

  async function projectWorldPoints(
    page: import('@playwright/test').Page,
    points: readonly { x: number; y: number }[],
  ) {
    const view = await page.evaluate(async () => {
      const perf = (
        window as unknown as {
          __varvePerf?: {
            forceFullRedraw(): Promise<unknown>;
            getLast(): {
              camera?: { zoom: number; panX: number; panY: number; rotation: number };
            } | null;
          };
        }
      ).__varvePerf;
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      const parent = canvas?.parentElement;
      if (!perf || !canvas || !parent)
        throw new Error('artboard pointer setup requires a mounted perf canvas');
      // Finish a current frame after toolbar/breadcrumb geometry changes.
      // This is setup only; inspector coordinates remain the independent oracle.
      await perf.forceFullRedraw();
      const camera = perf.getLast()?.camera;
      if (!camera) throw new Error('artboard pointer setup has no committed camera');
      const rect = canvas.getBoundingClientRect();
      return {
        camera,
        viewport: { width: parent.clientWidth, height: parent.clientHeight },
        left: rect.left,
        top: rect.top,
      };
    });
    const camera = {
      zoom: view.camera.zoom,
      pan: { x: view.camera.panX, y: view.camera.panY },
      rotation: view.camera.rotation,
    };
    return points.map((point) => {
      const screen = worldToScreen(camera, point.x, point.y, view.viewport);
      return { x: view.left + screen[0], y: view.top + screen[1] };
    });
  }

  async function plainClick(page: import('@playwright/test').Page, worldX: number, worldY: number) {
    const [point] = await projectWorldPoints(page, [{ x: worldX, y: worldY }]);
    if (!point) throw new Error('artboard click has no projected point');
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(350);
  }

  async function deepClick(page: import('@playwright/test').Page, worldX: number, worldY: number) {
    const [point] = await projectWorldPoints(page, [{ x: worldX, y: worldY }]);
    if (!point) throw new Error('artboard deep click has no projected point');
    await page.keyboard.down('Control');
    await page.mouse.click(point.x, point.y);
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
    // Park the initial camera so the declared world-space fixture is on the
    // drawable viewport. Subsequent gestures still resolve the live camera.
    const parked = await page.evaluate(() =>
      (
        window as unknown as {
          __varvePerf?: {
            camera: {
              setState(camera: {
                zoom: number;
                pan: { x: number; y: number };
                rotation: number;
              }): boolean;
            };
          };
        }
      ).__varvePerf?.camera.setState({ zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 }),
    );
    expect(parked).toBe(true);
    // Artboard at world (50,50) 400x300.
    await page.keyboard.press('f');
    const [frameStart, frameEnd] = await projectWorldPoints(page, [
      { x: 50, y: 50 },
      { x: 450, y: 350 },
    ]);
    if (!frameStart || !frameEnd) throw new Error('frame setup has no projected endpoints');
    await dragAtScreen(page, frameStart.x, frameStart.y, frameEnd.x, frameEnd.y);
    // Child rect at artboard-local (60,60)-(200,150).
    await page.keyboard.press('r');
    const [childStart, childEnd] = await projectWorldPoints(page, [
      { x: 110, y: 110 },
      { x: 250, y: 200 },
    ]);
    if (!childStart || !childEnd) throw new Error('child setup has no projected endpoints');
    await dragAtScreen(page, childStart.x, childStart.y, childEnd.x, childEnd.y);

    await page.keyboard.press('v');
    await page.waitForTimeout(300);
    // Resolve the live camera and drawable origin after the tool transition.
    await deepClick(page, 150, 150);

    // Drawn at local (60,60): inspector shows artboard-relative values.
    const xBefore = await readField(page, 'X', 60);
    const yBefore = await readField(page, 'Y', 60);

    // Move the artboard by dragging its fill at world (80,80) — inside the
    // frame, outside the child — by (+250, +200).
    await plainClick(page, 80, 80);
    const [moveStart, moveMid, moveEnd] = await projectWorldPoints(page, [
      { x: 80, y: 80 },
      { x: 205, y: 80 },
      { x: 330, y: 280 },
    ]);
    if (!moveStart || !moveMid || !moveEnd)
      throw new Error('frame move has no projected endpoints');
    await page.mouse.move(moveStart.x, moveStart.y);
    await page.mouse.down();
    await page.mouse.move(moveMid.x, moveMid.y, { steps: 6 });
    await page.mouse.move(moveEnd.x, moveEnd.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    // The frame+child moved together: clicking the child's NEW world
    // position (360,310)-(500,400) selects the CHILD (topmost hit) and its
    // stored local X/Y is unchanged — children are never rewritten by a
    // parent move.
    await deepClick(page, 420, 350);
    await readField(page, 'X', xBefore);
    await readField(page, 'Y', yBefore);

    // Clicking the frame's fill (now world 300,250..700,550, outside the
    // child) selects the frame at its new placement. The drag's grab point
    // sits a few px off the frame origin, so tolerance is generous.
    await plainClick(page, 330, 280);
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
    await page.keyboard.press('f');
    // Finish the tool transition before reading geometry. The Frame tool's
    // contextual row shifts the drawable canvas; its former origin hits a ruler.
    await projectWorldPoints(page, []);
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
    const start = { x: canvasBox.x + 30, y: canvasBox.y + 40 };
    expect(
      await canvas.evaluate(
        (element, point) => document.elementFromPoint(point.x, point.y) === element,
        start,
      ),
    ).toBe(true);
    await dragAtScreen(page, start.x, start.y, start.x + frameWidth, start.y + frameHeight);
    await page.keyboard.press('v');
    await frameARow.click();
    await expect(frameARow).toHaveAttribute('aria-selected', 'true');
    const frameAX = Number(await page.getByRole('spinbutton', { name: 'X (px)' }).inputValue());
    const frameAY = Number(await page.getByRole('spinbutton', { name: 'Y (px)' }).inputValue());
    const frameAW = Number(
      await page.getByRole('spinbutton', { name: 'W (px)', exact: true }).inputValue(),
    );
    const frameAH = Number(
      await page.getByRole('spinbutton', { name: 'H (px)', exact: true }).inputValue(),
    );

    // Draw a real child inside A using A's current overlay bounds. This makes
    // its parent relationship independent of camera origin and zoom.
    await page.keyboard.press('r');
    const [childStart, childEnd] = await projectWorldPoints(page, [
      { x: frameAX + frameAW * 0.2, y: frameAY + frameAH * 0.2 },
      { x: frameAX + frameAW * 0.58, y: frameAY + frameAH * 0.58 },
    ]);
    if (!childStart || !childEnd) throw new Error('child setup has no projected endpoints');
    await dragAtScreen(page, childStart.x, childStart.y, childEnd.x, childEnd.y);

    // Place B beside A using the live on-screen frame bounds, then expand A
    // so selecting its child is independent of whichever frame is selected.
    await page.keyboard.press('f');
    const [frameBStart, frameBEnd] = await projectWorldPoints(page, [
      { x: frameAX + frameAW + 15, y: frameAY },
      { x: frameAX + frameAW * 2 + 15, y: frameAY + frameAH },
    ]);
    if (!frameBStart || !frameBEnd) throw new Error('second frame has no projected endpoints');
    const liveCanvasBox = await canvas.boundingBox();
    if (!liveCanvasBox || frameBEnd.x > liveCanvasBox.x + liveCanvasBox.width - 8) {
      throw new Error('canvas does not have room to place the second artboard beside the first');
    }
    await dragAtScreen(page, frameBStart.x, frameBStart.y, frameBEnd.x, frameBEnd.y);
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

    const zoomPercent = Number(await page.locator('#status-zoom').inputValue());
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
