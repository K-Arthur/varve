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
 * canvas-relative drags assume the fresh-design camera, selection uses
 * layers-panel rows (clicking the LABEL text — row centers carry "Zoom to"
 * action buttons that fit-zoom the camera), and inspector X/Y fields are the
 * numeric authority for stored coordinates.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Artboard-local coordinates', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function selectLayer(page: import('@playwright/test').Page, name: RegExp) {
    // Click the row's LABEL text, not the row center: the row carries
    // action buttons ("Zoom to <layer>") that fit-zoom the camera when hit
    // accidentally, corrupting subsequent canvas-relative coordinates.
    await page
      .locator('.layers-panel')
      .getByRole('treeitem', { name })
      .getByText(/^(Rectangle|Frame|Group) \d+$/)
      .click();
    await page.waitForTimeout(350);
  }

  async function plainClick(
    page: import('@playwright/test').Page,
    box: { x: number; y: number },
    worldX: number,
    worldY: number,
  ) {
    await page.mouse.click(box.x + worldX, box.y + worldY);
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
    await selectLayer(page, /Rectangle 1/);

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
    await plainClick(page, box, 420, 350);
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
    const boxA = await dragOnCanvas(page, 50, 50, 450, 350);
    await page.keyboard.press('f');
    await dragOnCanvas(page, 500, 50, 900, 350);

    // Child inside A at local (60,60) — world (110,110).
    await page.keyboard.press('r');
    await dragOnCanvas(page, 110, 110, 250, 200);

    await page.keyboard.press('v');
    await page.waitForTimeout(300);
    await selectLayer(page, /Rectangle 1/);
    await readField(page, 'X', 60);

    // Drag the child into artboard B: from world (150,130) to (650,130).
    await page.mouse.move(boxA.x + 150, boxA.y + 130);
    await page.mouse.down();
    await page.mouse.move(boxA.x + 200, boxA.y + 130, { steps: 5 });
    await page.mouse.move(boxA.x + 650, boxA.y + 130, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    // No teleport: the child's world pose is preserved — its local X/Y is
    // now B-relative: 110-500 = -390.
    await selectLayer(page, /Rectangle 1/);
    await readField(page, 'X', -390);
    await readField(page, 'Y', 60);

    // Undo the reparent: back in A at local (60,60).
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    await selectLayer(page, /Rectangle 1/);
    await readField(page, 'X', 60);

    // Redo: back in B at (-390, 60) — the world pose survived the cycle.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(600);
    await selectLayer(page, /Rectangle 1/);
    await readField(page, 'X', -390);
  });
});
