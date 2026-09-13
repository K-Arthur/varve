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

const MULTI_SELECTION_SNAP_DOCUMENT = {
  id: 'multi-selection-snap-document',
  formatVersion: '2.0',
  name: 'Multi-selection snap',
  rootChildren: ['target', 'primary', 'secondary'],
  nodes: {
    target: {
      id: 'target',
      kind: 'shape',
      name: 'Rectangle 1',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 250, 140],
      fill: { space: 'rgb', r: 220, g: 100, b: 80, a: 255 },
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    },
    primary: {
      id: 'primary',
      kind: 'shape',
      name: 'Rectangle 2',
      layerColor: null,
      order: 'a1',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 160, 420],
      fill: { space: 'rgb', r: 40, g: 190, b: 180, a: 255 },
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 80, h: 80 },
    },
    secondary: {
      id: 'secondary',
      kind: 'shape',
      name: 'Rectangle 3',
      layerColor: null,
      order: 'a2',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 320, 460],
      fill: { space: 'rgb', r: 40, g: 190, b: 180, a: 255 },
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 80, h: 80 },
    },
  },
  components: {},
  // Keep this workflow focused on object geometry. Document-grid snapping is
  // an explicit, separate operation and otherwise wins over the object edge
  // at the 8px default grid step.
  gridSettings: {
    documentGrid: {
      id: 'grid-document-test',
      type: 'document',
      name: 'Document Grid',
      visible: false,
      snapEnabled: false,
      color: '#7a7a7a',
      opacity: 0.4,
      scope: 'document',
      spacingX: 8,
      spacingY: 8,
      subdivisions: 4,
      offsetX: 0,
      offsetY: 0,
    },
  },
  nextId: 4,
};

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

/**
 * Keep the snap workflow on the actual editor surface when a concurrent Vite
 * transform briefly returns Home during document creation.
 */
async function navigateToStableEditor(page: Page): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await navigateToEditor(page, '/', { startupTimeout: 90_000 });
      await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('canvas.editor-canvas__content-layer').waitFor({
        state: 'visible',
        timeout: 30_000,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await page.waitForTimeout(250);
    }
  }
  throw lastError;
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
    await navigateToStableEditor(page);
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

  test('snaps a multi-selection as one rigid block without self-targeting', async ({
    page,
  }, testInfo) => {
    await page.locator('#file-open-input').setInputFiles({
      name: 'multi-selection-snap.strata',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(MULTI_SELECTION_SNAP_DOCUMENT)),
    });
    await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 90_000 });
    await page.locator('canvas.editor-canvas__content-layer').waitFor({
      state: 'visible',
      timeout: 60_000,
    });
    await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 10_000 });

    await selectRect(page, 'Rectangle 1');
    const target = await readXY(page);
    const targetScreen = await selectedScreenRect(page);

    await selectRect(page, 'Rectangle 2');
    const primaryBefore = await readXY(page);
    await selectRect(page, 'Rectangle 3');
    const secondaryBefore = await readXY(page);

    await selectRect(page, 'Rectangle 2');
    await page.getByRole('treeitem', { name: /Rectangle 3/i }).click({ modifiers: ['Control'] });
    const selectionScreen = await selectedScreenRect(page);
    const primaryStart = {
      x: selectionScreen.x + 40,
      y: selectionScreen.y + 40,
    };
    const desiredPrimaryTopLeft = {
      x: targetScreen.x + 3,
      y: targetScreen.y + targetScreen.height + 80,
    };
    await captureState(page, testInfo, 'snap-multi-selection-before');

    await dragScreen(
      page,
      // The diagonal fixture has an empty gap at the overall selection
      // centre. Start on the primary mover's rendered fill so SelectTool
      // enters the move path instead of interpreting the gesture as a
      // marquee.
      primaryStart,
      {
        // The primary's left edge ends three CSS pixels from the target's
        // left edge; the common correction must move both objects together.
        x: primaryStart.x + desiredPrimaryTopLeft.x - selectionScreen.x,
        y: primaryStart.y + desiredPrimaryTopLeft.y - selectionScreen.y,
      },
      () => captureState(page, testInfo, 'snap-multi-selection-during'),
    );
    await page.waitForTimeout(250);

    await selectRect(page, 'Rectangle 2');
    const primaryAfter = await readXY(page);
    await selectRect(page, 'Rectangle 3');
    const secondaryAfter = await readXY(page);
    await captureState(page, testInfo, 'snap-multi-selection-after');

    expect(primaryAfter.x).toBe(target.x);
    expect(primaryAfter.x - primaryBefore.x).toBeCloseTo(secondaryAfter.x - secondaryBefore.x, 8);
    expect(primaryAfter.y - primaryBefore.y).toBeCloseTo(secondaryAfter.y - secondaryBefore.y, 8);
  });

  test('snaps to a moved target after save and reopen', async ({ page }, testInfo) => {
    await drawRect(page, 150, 180, 250, 280); // target
    await drawRect(page, 400, 180, 500, 280); // mover
    await selectRect(page, 'Rectangle 1');
    const targetBefore = await selectedScreenRect(page);
    await dragScreen(
      page,
      { x: targetBefore.x + targetBefore.width / 2, y: targetBefore.y + targetBefore.height / 2 },
      {
        x: targetBefore.x + targetBefore.width / 2 + 100,
        y: targetBefore.y + targetBefore.height / 2 + 40,
      },
    );
    await page.waitForTimeout(250);
    const target = await readXY(page);

    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30_000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.locator('.varve-home__toolbar').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('gridcell').first().dblclick();
    await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('canvas.editor-canvas__content-layer').waitFor({
      state: 'visible',
      timeout: 60_000,
    });
    await page.waitForTimeout(500);
    await captureState(page, testInfo, 'snap-after-reopen-before');

    await selectRect(page, 'Rectangle 1');
    const targetScreen = await selectedScreenRect(page);
    await selectRect(page, 'Rectangle 2');
    const moverScreen = await selectedScreenRect(page);
    await dragScreen(
      page,
      { x: moverScreen.x + moverScreen.width / 2, y: moverScreen.y + moverScreen.height / 2 },
      {
        x: targetScreen.x + 3 + moverScreen.width / 2,
        y: targetScreen.y + 180 + moverScreen.height / 2,
      },
      () => captureState(page, testInfo, 'snap-after-reopen-during'),
    );
    await page.waitForTimeout(250);
    const after = await readXY(page);
    await captureState(page, testInfo, 'snap-after-reopen-after');
    expect(after.x).toBe(target.x);
  });
});
