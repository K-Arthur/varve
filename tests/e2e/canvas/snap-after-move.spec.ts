/**
 * Snapping must keep working against objects that have already been moved.
 *
 * The snap broad phase queries a spatial index keyed by grid cell. That index
 * used to be cached per document id — an id that never changes while a document
 * is open — so it was built once and never refreshed. A node that moved kept
 * its original cell membership, and once it left those cells the broad phase
 * stopped returning it: the object silently became unsnappable.
 *
 * Unit tests pin the index behaviour, but only a real drag exercises the whole
 * path (pointer events -> tool dispatch -> broad phase -> snapPosition ->
 * committed geometry), which is what AGENTS.md requires for canvas/pointer
 * behaviour. The assertion is exact coordinate equality: an edge snap lands the
 * dragged node's left edge exactly on the target's, whereas an unsnapped drag
 * lands wherever the pointer stopped.
 */
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

async function readXY(page: Page): Promise<{ x: number; y: number }> {
  const xField = page.getByRole('spinbutton', { name: /^x(?: \(ab\))? \(px\)$/i });
  const yField = page.getByRole('spinbutton', { name: /^y(?: \(ab\))? \(px\)$/i });
  await expect(xField).toBeAttached({ timeout: 5000 });
  return { x: Number(await xField.inputValue()), y: Number(await yField.inputValue()) };
}

/** Draw a rect with the rect tool, then return to the select tool. */
async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, x1, y1, x2, y2);
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
}

async function selectRect(page: Page, name: string) {
  const item = page.getByRole('treeitem', { name: new RegExp(name, 'i') });
  await expect(item).toHaveCount(1, { timeout: 5000 });
  await item.click();
  await page.waitForTimeout(150);
}

/** Read the actual screen-space selection rectangle, independent of camera zoom. */
async function selectedScreenRect(page: Page) {
  const rect = page.locator('svg:has(.selection-overlay__dim) > rect').first();
  await expect(rect).toBeAttached({ timeout: 5000 });
  const box = await rect.boundingBox();
  if (!box) throw new Error('selection rectangle has no screen bounds');
  return box;
}

async function dragScreen(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  beforeRelease?: () => Promise<void>,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x, to.y);
  await beforeRelease?.();
  await page.mouse.up();
}

async function captureState(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

// STATUS: ACTIVE — real pointer and Inspector evidence.
//
// The original version mixed Inspector document coordinates with the helper's
// canvas coordinates and was therefore skipped. These tests now use the real
// rendered selection rectangle for pointer coordinates, while retaining the
// Inspector value for the exact post-snap assertion.
test.describe('snapping after a target has moved', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('snaps to a node that was moved after the document opened', async ({ page }, testInfo) => {
    // Two rects, far enough apart that their index cells do not overlap but
    // both well inside the drawable area proven by the other canvas specs.
    await drawRect(page, 150, 180, 250, 280); // target
    await drawRect(page, 400, 180, 500, 280); // mover
    await expect(page.getByRole('treeitem').filter({ hasText: /rect/i })).toHaveCount(2, {
      timeout: 10000,
    });
    await captureState(page, testInfo, 'snap-after-move-before');

    await selectRect(page, 'Rectangle 1');
    const targetBefore = await selectedScreenRect(page);
    // Move the target to a nearby, still-visible cell. Keeping
    // the target on the canvas avoids edge auto-pan changing the camera while
    // the second drag is being planned; the index-refresh regression does not
    // require an off-screen move.
    // This is the step that used to poison the broad phase.
    await dragScreen(
      page,
      { x: targetBefore.x + targetBefore.width / 2, y: targetBefore.y + targetBefore.height / 2 },
      {
        x: targetBefore.x + targetBefore.width / 2 + 100,
        y: targetBefore.y + targetBefore.height / 2 + 40,
      },
    );
    await page.waitForTimeout(200);
    const target = await readXY(page);
    const targetScreen = await selectedScreenRect(page);
    await captureState(page, testInfo, 'snap-after-target-moved');

    // Now drag the second rect so its left edge lands *near* the target's left
    // edge — close enough that an edge snap must engage.
    await selectRect(page, 'Rectangle 2');
    const moverScreen = await selectedScreenRect(page);
    await dragScreen(
      page,
      { x: moverScreen.x + moverScreen.width / 2, y: moverScreen.y + moverScreen.height / 2 },
      {
        // Three CSS pixels is inside the magnetic tolerance but keeps the
        // target and mover far apart on the other axis.
        x: targetScreen.x + 3 + moverScreen.width / 2,
        y: targetScreen.y + 180 + moverScreen.height / 2,
      },
      () => captureState(page, testInfo, 'snap-after-move-during'),
    );
    await page.waitForTimeout(250);

    const after = await readXY(page);
    await captureState(page, testInfo, 'snap-after-move-after');
    // Edge snap puts the two left edges on exactly the same coordinate.
    // Before the fix the target was invisible to the broad phase and this
    // landed 3px off.
    expect(after.x).toBe(target.x);
  });

  test('snaps to a node created after the document opened', async ({ page }, testInfo) => {
    // The index was also never rebuilt for insertions, so a freshly created
    // object could not be snapped to either.
    await drawRect(page, 250, 250, 350, 350); // anchor, present at first drag
    await selectRect(page, 'Rectangle 1');
    const anchorBefore = await selectedScreenRect(page);
    await dragScreen(
      page,
      { x: anchorBefore.x + anchorBefore.width / 2, y: anchorBefore.y + anchorBefore.height / 2 },
      {
        x: anchorBefore.x + anchorBefore.width / 2 + 40,
        y: anchorBefore.y + anchorBefore.height / 2,
      },
    ); // force the index to build
    await page.waitForTimeout(200);

    await drawRect(page, 640, 500, 740, 600); // created afterwards
    const created = await readXY(page);
    const createdScreen = await selectedScreenRect(page);
    await captureState(page, testInfo, 'snap-after-create-before');

    // The newly created rectangle is the top layer; select the original
    // anchor beneath it so the created node is the stationary candidate.
    await selectRect(page, 'Rectangle 1');
    const anchorScreen = await selectedScreenRect(page);
    await dragScreen(
      page,
      { x: anchorScreen.x + anchorScreen.width / 2, y: anchorScreen.y + anchorScreen.height / 2 },
      {
        x: createdScreen.x + 3 + anchorScreen.width / 2,
        y: createdScreen.y - 180 + anchorScreen.height / 2,
      },
      () => captureState(page, testInfo, 'snap-after-create-during'),
    );
    await page.waitForTimeout(250);

    const after = await readXY(page);
    await captureState(page, testInfo, 'snap-after-create-after');
    expect(after.x).toBe(created.x);
  });
});
