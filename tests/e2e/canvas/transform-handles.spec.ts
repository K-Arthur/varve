import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Regression coverage for two connected SelectionOverlay defects:
 *
 * 1. Every resize- or rotate-handle drag crashed the editor on release.
 *    `handlePointerUp` called `updateDoc((doc) => dragRef.current!.engine
 *    .commit(doc))` and then synchronously set `dragRef.current = null` on
 *    the next line. `updateDoc`'s functional setState updater — which is
 *    what actually invokes that callback — runs after the handler returns,
 *    not synchronously within it, so the callback always read `dragRef
 *    .current` back as `null` by the time it ran: "Cannot read properties
 *    of null (reading 'engine')", caught by the top-level ErrorBoundary,
 *    which silently rebuilt EditorProvider from scratch (losing all
 *    selection/document UI state). This affected every single handle-driven
 *    resize or rotate, unconditionally — not an edge case.
 *
 * 2. TransformEngine.bakeNode() stored the decomposed rotation angle in
 *    radians (Math.atan2 return value) directly into node.rotation, which
 *    every other consumer (nodeWorldTransform's rotateDeg call) treats as
 *    degrees — so a committed rotate/resize with a non-zero final angle
 *    would snap back to a near-zero visible rotation on release.
 *
 * Neither was catchable by unit tests: (1) depends on real React setState
 * batching/scheduling timing that jsdom + RTL's act() wrapping does not
 * reproduce, and (2) has passing coverage for the world-matrix math but no
 * assertion on the baked `node.rotation` field itself.
 */
test.describe('Selection overlay transform handles', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('resizing from a corner handle does not crash the editor and produces the correct size', async ({
    page,
  }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 300, 300, 500, 450);
    await page.keyboard.press('v');
    await page.waitForTimeout(200);

    const wField = page.getByRole('spinbutton', { name: 'W (px)', exact: true });
    const hField = page.getByRole('spinbutton', { name: 'H (px)', exact: true });
    await expect(wField).toHaveValue('200');
    await expect(hField).toHaveValue('150');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // SE corner handle sits at the shape's bottom-right corner.
    const seX = box.x + 500;
    const seY = box.y + 450;
    await page.mouse.move(seX, seY);
    await page.mouse.down();
    await page.mouse.move(seX + 40, seY + 30);
    await page.mouse.move(seX + 80, seY + 60);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // The editor must still be alive and usable — this is the crash guard.
    await expect(page.locator('.layers-panel')).toBeVisible();
    await expect(page.locator('svg:has(filter#selection-glow)')).toBeVisible();

    const newW = Number(await wField.inputValue());
    const newH = Number(await hField.inputValue());
    expect(newW).toBeGreaterThan(200);
    expect(newH).toBeGreaterThan(150);
    // A drag of (+80,+60) screen px at 100% zoom should grow by roughly that
    // much (allow slack for snapping).
    expect(newW).toBeCloseTo(280, -1);
    expect(newH).toBeCloseTo(210, -1);
  });

  test('rotating via the rotation handle does not crash and commits a sane degree value', async ({
    page,
  }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 300, 300, 500, 450);
    await page.keyboard.press('v');
    await page.waitForTimeout(200);

    const rField = page.getByRole('spinbutton', { name: /^R \(/ });
    await expect(rField).toHaveValue('0');

    const overlaySvg = page.locator('svg:has(filter#selection-glow)');
    const outline = overlaySvg.locator(':scope > rect').first();
    const r = await outline.evaluate((el) => el.getBoundingClientRect());
    const rotHandleX = r.x + r.width / 2;
    const rotHandleY = r.y - 20;

    await page.mouse.move(rotHandleX, rotHandleY);
    await page.mouse.down();
    await page.mouse.move(rotHandleX + 60, rotHandleY + 10);
    await page.mouse.move(rotHandleX + 80, rotHandleY + 40);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Crash guard.
    await expect(page.locator('.layers-panel')).toBeVisible();
    await expect(overlaySvg).toBeVisible();

    const rotation = Number(await rField.inputValue());
    // A degrees value from a real drag must land somewhere in a normal
    // visually-meaningful range — the pre-fix bug produced ~0.01x the
    // intended angle (radians stored where degrees were expected).
    expect(rotation).toBeGreaterThan(10);
    expect(rotation).toBeLessThan(170);

    // Rotating back to exactly 0 via the numeric field must round-trip
    // cleanly through the same world-transform math.
    await rField.fill('0');
    await rField.press('Enter');
    await page.waitForTimeout(200);
    await expect(rField).toHaveValue('0');
    await expect(page.locator('.layers-panel')).toBeVisible();
  });
});
