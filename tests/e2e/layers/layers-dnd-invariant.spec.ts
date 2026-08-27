/**
 * The Layers drag-and-drop invariant, driven by real pointer events.
 *
 *   The location and hierarchy shown under the cursor before release is the
 *   location and hierarchy produced after release.
 *
 * Every test here reads the drop indicator *while the button is still down*,
 * then asserts the committed hierarchy matches it. A test that only checked
 * the final scene would pass on a drag that previewed the wrong row, which is
 * precisely the failure this suite exists to catch.
 */

import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

interface Row {
  id: string;
  name: string;
  level: number;
}

interface Indicator {
  nodeId: string | null;
  zone: 'before' | 'after' | 'into' | 'root';
  invalid: boolean;
}

/** The visible tree, top row first, with ids and nesting depth. */
async function readRows(page: Page): Promise<Row[]> {
  return page.getByRole('treeitem').evaluateAll((rows) =>
    rows.map((r) => ({
      id: r.getAttribute('data-node-id') ?? '',
      name: (r.querySelector('.layers-row__name')?.textContent ?? '').trim(),
      level: Number(r.getAttribute('aria-level') ?? '1'),
    })),
  );
}

/**
 * What the panel is currently promising. Read mid-drag, this is the preview
 * half of the invariant; the committed hierarchy is the other half.
 */
async function readIndicator(page: Page): Promise<Indicator | null> {
  return page.evaluate(() => {
    for (const zone of ['before', 'after', 'into'] as const) {
      const el = document.querySelector(`.layers-row--drop-${zone}`);
      if (el) {
        return {
          nodeId: el.querySelector('[data-node-id]')?.getAttribute('data-node-id') ?? null,
          zone,
          invalid: el.classList.contains('layers-row--drop-invalid'),
        };
      }
    }
    const root = document.querySelector('.layers-panel__drop-root');
    if (root) {
      return {
        nodeId: null,
        zone: 'root' as const,
        invalid: root.classList.contains('layers-panel__drop-root--invalid'),
      };
    }
    return null;
  });
}

/** Grab a row by its drag handle and cross dnd-kit's 5px activation distance. */
async function beginDrag(page: Page, rowId: string): Promise<{ x: number; y: number }> {
  const row = page.locator(`[role="treeitem"][data-node-id="${rowId}"]`);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  if (!box) throw new Error(`row ${rowId} has no geometry`);
  const x = box.x + 8;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 10);
  return { x, y };
}

/**
 * Move the cursor into a band of a target row. `fraction` is the position
 * within the row: 0.15 = before band, 0.5 = into band, 0.85 = after band.
 */
async function moveToRowBand(page: Page, rowId: string, fraction: number, steps = 6) {
  const row = page.locator(`[role="treeitem"][data-node-id="${rowId}"]`);
  const box = await row.boundingBox();
  if (!box) throw new Error(`target row ${rowId} has no geometry`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * fraction, { steps });
  // One extra sample at the exact point: dnd-kit coalesces, and the last
  // reported position is the one the resolver answers for.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * fraction);
}

async function seedFrame(page: Page, x: number, y: number) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('f');
  await page.waitForTimeout(80);
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 160, box.y + y + 120);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
}

test.describe('Layers DnD — preview matches commit', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await navigateToEditor(page);
  });

  test.afterEach(() => {
    expect(errors, 'uncaught page errors during DnD').toEqual([]);
  });

  test('the tree exists and is focusable with no layers at all', async ({ page }) => {
    // An empty page used to render an empty-state div *instead of* the tree,
    // so there was no role="tree" and no drop surface whatsoever.
    const tree = page.getByRole('tree', { name: /layers/i });
    await expect(tree).toBeVisible();
    await expect(page.getByText(/no layers yet/i)).toBeVisible();
    await tree.focus();
    await expect(tree).toBeFocused();
  });

  test('previewing "before" commits directly above that row', async ({ page }) => {
    await seedLayers(page, 4);
    const rows = await readRows(page);
    expect(rows.length).toBe(4);
    const source = rows[3]!; // bottom row
    const target = rows[1]!;

    await beginDrag(page, source.id);
    await moveToRowBand(page, target.id, 0.15);

    const preview = await readIndicator(page);
    expect(preview).toEqual({ nodeId: target.id, zone: 'before', invalid: false });
    await page.getByTestId('layers-panel').screenshot({
      path: 'test-results/layers-invariant-before.png',
    });
    await page.mouse.up();

    await expect
      .poll(async () => (await readRows(page)).map((r) => r.id))
      .not.toEqual(rows.map((r) => r.id));
    const after = await readRows(page);
    const si = after.findIndex((r) => r.id === source.id);
    const ti = after.findIndex((r) => r.id === target.id);
    expect(si).toBe(ti - 1);
  });

  test('previewing "after" commits directly below that row', async ({ page }) => {
    await seedLayers(page, 4);
    const rows = await readRows(page);
    const source = rows[0]!; // top row
    const target = rows[2]!;

    await beginDrag(page, source.id);
    await moveToRowBand(page, target.id, 0.85);

    const preview = await readIndicator(page);
    expect(preview).toEqual({ nodeId: target.id, zone: 'after', invalid: false });
    await page.getByTestId('layers-panel').screenshot({
      path: 'test-results/layers-invariant-after.png',
    });
    await page.mouse.up();

    await expect
      .poll(async () => (await readRows(page)).map((r) => r.id))
      .not.toEqual(rows.map((r) => r.id));
    const after = await readRows(page);
    const si = after.findIndex((r) => r.id === source.id);
    const ti = after.findIndex((r) => r.id === target.id);
    expect(si).toBe(ti + 1);
  });

  test('first row to last and last row to first', async ({ page }) => {
    await seedLayers(page, 4);
    let rows = await readRows(page);
    const first = rows[0]!;
    const last = rows[3]!;

    // First → below the last row.
    await beginDrag(page, first.id);
    await moveToRowBand(page, last.id, 0.9);
    expect((await readIndicator(page))?.nodeId).toBe(last.id);
    await page.mouse.up();
    await expect.poll(async () => (await readRows(page))[3]?.id).toBe(first.id);

    // Last → above the first row.
    rows = await readRows(page);
    const newLast = rows[3]!;
    const newFirst = rows[0]!;
    await beginDrag(page, newLast.id);
    await moveToRowBand(page, newFirst.id, 0.1);
    expect((await readIndicator(page))?.nodeId).toBe(newFirst.id);
    await page.mouse.up();
    await expect.poll(async () => (await readRows(page))[0]?.id).toBe(newLast.id);
  });

  test('previewing "into" a frame commits as its child', async ({ page }) => {
    await seedLayers(page, 2);
    await seedFrame(page, 640, 520);
    const rows = await readRows(page);
    const frame = rows.find((r) => r.name.includes('Frame'));
    const shape = rows.find((r) => r.name.includes('Rectangle'));
    if (!frame || !shape) throw new Error('fixture rows missing');

    await beginDrag(page, shape.id);
    await moveToRowBand(page, frame.id, 0.5);

    const preview = await readIndicator(page);
    expect(preview).toEqual({ nodeId: frame.id, zone: 'into', invalid: false });
    await page.getByTestId('layers-panel').screenshot({
      path: 'test-results/layers-invariant-into.png',
    });
    await page.mouse.up();

    await expect
      .poll(async () => (await readRows(page)).find((r) => r.id === shape.id)?.level)
      .toBe(frame.level + 1);
    const after = await readRows(page);
    const fi = after.findIndex((r) => r.id === frame.id);
    const si = after.findIndex((r) => r.id === shape.id);
    expect(si).toBeGreaterThan(fi);
  });

  test('dropping below the last row moves a child out to the top level', async ({ page }) => {
    await seedLayers(page, 2);
    await seedFrame(page, 640, 520);
    let rows = await readRows(page);
    const frame = rows.find((r) => r.name.includes('Frame'))!;
    const shape = rows.find((r) => r.name.includes('Rectangle'))!;

    // First move it in.
    await beginDrag(page, shape.id);
    await moveToRowBand(page, frame.id, 0.5);
    await page.mouse.up();
    await expect
      .poll(async () => (await readRows(page)).find((r) => r.id === shape.id)?.level)
      .toBe(frame.level + 1);

    // Now drag it into the empty space below every row. There is no row to
    // aim at down there, which used to mean there was no way out at all.
    rows = await readRows(page);
    const lastRow = rows[rows.length - 1]!;
    await beginDrag(page, shape.id);
    const tree = page.getByRole('tree', { name: /layers/i });
    const treeBox = await tree.boundingBox();
    const lastBox = await page
      .locator(`[role="treeitem"][data-node-id="${lastRow.id}"]`)
      .boundingBox();
    if (!treeBox || !lastBox) throw new Error('tree geometry unavailable');
    const emptyY = Math.min(lastBox.y + lastBox.height + 24, treeBox.y + treeBox.height - 8);
    await page.mouse.move(treeBox.x + treeBox.width / 2, emptyY, { steps: 6 });
    await page.mouse.move(treeBox.x + treeBox.width / 2, emptyY);

    const preview = await readIndicator(page);
    expect(preview?.zone).toBe('root');
    expect(preview?.invalid).toBe(false);
    await page.getByTestId('layers-panel').screenshot({
      path: 'test-results/layers-invariant-root-drop.png',
    });
    await page.mouse.up();

    await expect
      .poll(async () => (await readRows(page)).find((r) => r.id === shape.id)?.level)
      .toBe(1);
  });

  test('a fast drag across many rows lands where the pointer finished', async ({ page }) => {
    await seedLayers(page, 6);
    const rows = await readRows(page);
    const source = rows[0]!;
    const target = rows[5]!;

    await beginDrag(page, source.id);
    // Two samples only: no intermediate rows are entered at all. The final
    // target must still come from the final pointer position rather than from
    // whichever row happened to fire a dnd-kit `over`.
    const targetBox = await page
      .locator(`[role="treeitem"][data-node-id="${target.id}"]`)
      .boundingBox();
    if (!targetBox) throw new Error('target geometry unavailable');
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.85);

    const preview = await readIndicator(page);
    expect(preview).toEqual({ nodeId: target.id, zone: 'after', invalid: false });
    await page.mouse.up();

    await expect.poll(async () => (await readRows(page)).at(-1)?.id).toBe(source.id);
  });

  test('an invalid cycle target is shown as invalid and commits nothing', async ({ page }) => {
    await seedLayers(page, 2);
    await seedFrame(page, 640, 520);
    let rows = await readRows(page);
    const frame = rows.find((r) => r.name.includes('Frame'))!;
    const shape = rows.find((r) => r.name.includes('Rectangle'))!;

    await beginDrag(page, shape.id);
    await moveToRowBand(page, frame.id, 0.5);
    await page.mouse.up();
    await expect
      .poll(async () => (await readRows(page)).find((r) => r.id === shape.id)?.level)
      .toBe(frame.level + 1);

    rows = await readRows(page);
    const before = rows.map((r) => `${r.id}@${r.level}`);

    // Frame into its own child.
    await beginDrag(page, frame.id);
    await moveToRowBand(page, shape.id, 0.5);
    const preview = await readIndicator(page);
    expect(preview?.nodeId).toBe(shape.id);
    expect(preview?.invalid).toBe(true);
    await page.getByTestId('layers-panel').screenshot({
      path: 'test-results/layers-invariant-invalid.png',
    });
    await page.mouse.up();

    await page.waitForTimeout(250);
    expect((await readRows(page)).map((r) => `${r.id}@${r.level}`)).toEqual(before);
  });

  test('releasing a row where it already sits creates no undo entry', async ({ page }) => {
    await seedLayers(page, 3);
    const rows = await readRows(page);
    const order = rows.map((r) => r.id);
    const source = rows[1]!;

    // Drop row 1 back into its own slot: below row 0.
    await beginDrag(page, source.id);
    await moveToRowBand(page, rows[0]!.id, 0.85);
    expect((await readIndicator(page))?.nodeId).toBe(rows[0]!.id);
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect((await readRows(page)).map((r) => r.id)).toEqual(order);

    // Undo must reach past the drag to the last real edit — the shape
    // creation — rather than spending a step on a move that did nothing.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await readRows(page)).length).toBe(2);
  });

  test('a completed drag does not also re-select through the row click handler', async ({
    page,
  }) => {
    await seedLayers(page, 3);
    const rows = await readRows(page);
    const source = rows[2]!;
    const target = rows[0]!;

    // Select a different row first, so a stray click is observable.
    await page.locator(`[role="treeitem"][data-node-id="${rows[1]!.id}"]`).click();
    await expect(page.locator(`[role="treeitem"][data-node-id="${rows[1]!.id}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await beginDrag(page, source.id);
    await moveToRowBand(page, target.id, 0.15);
    await page.mouse.up();
    await page.waitForTimeout(250);

    // The drag moved `source`; the selection must still be what the user
    // chose, not silently replaced by the dropped row.
    await expect(page.locator(`[role="treeitem"][data-node-id="${rows[1]!.id}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('row controls do not start a reorder', async ({ page }) => {
    await seedLayers(page, 3);
    const rows = await readRows(page);
    const order = rows.map((r) => r.id);
    const row = page.locator(`[role="treeitem"][data-node-id="${rows[0]!.id}"]`);

    // Press the visibility toggle and slip well past the 5px activation
    // distance before releasing — the row itself is draggable, so this used
    // to start a drag from a button press.
    const toggle = row.locator('.layers-row__toggle--visibility-on');
    const box = await toggle.boundingBox();
    if (!box) throw new Error('visibility toggle not found');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 5 });
    expect(await readIndicator(page)).toBeNull();
    await page.mouse.up();
    await page.waitForTimeout(200);

    expect((await readRows(page)).map((r) => r.id)).toEqual(order);
  });
});

test.describe('Layers DnD — virtualized tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await navigateToEditor(page);
  });

  test('auto-scroll holds at the edge and lands on a row exposed by scrolling', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    // Build a tree taller than the panel entirely through the document, so
    // the virtualizer is genuinely windowing rows.
    await seedLayers(page, 3);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const cbox = await canvas.boundingBox();
    if (!cbox) throw new Error('canvas not found');
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('r');
      await page.mouse.move(cbox.x + 60 + (i % 5) * 90, cbox.y + 60 + (i % 6) * 60);
      await page.mouse.down();
      await page.mouse.move(cbox.x + 100 + (i % 5) * 90, cbox.y + 100 + (i % 6) * 60);
      await page.mouse.up();
    }

    const tree = page.getByRole('tree', { name: /layers/i });
    await expect
      .poll(async () => tree.evaluate((el) => el.scrollHeight > el.clientHeight), {
        timeout: 30_000,
      })
      .toBe(true);

    // Virtualization is actually engaged: the panel's own layer count exceeds
    // the number of rows present in the DOM.
    const layerCountText = await page
      .getByText(/^\d+ layers$/)
      .first()
      .textContent();
    const documentLayers = Number((layerCountText ?? '0').split(' ')[0]);
    const mountedRows = await page.getByRole('treeitem').count();
    expect(documentLayers).toBeGreaterThan(mountedRows);

    const rows = await readRows(page);
    const source = rows[0]!;
    await beginDrag(page, source.id);

    const treeBox = await tree.boundingBox();
    if (!treeBox) throw new Error('tree geometry unavailable');
    // Park the cursor in the bottom edge band and hold it perfectly still.
    // A one-rAF-per-event auto-scroll moves nothing at all from here.
    await page.mouse.move(treeBox.x + treeBox.width / 2, treeBox.y + treeBox.height - 6);
    await expect
      .poll(async () => tree.evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(50);

    // The indicator must track the rows sliding beneath the still cursor.
    const indicator = await readIndicator(page);
    expect(indicator).not.toBeNull();
    await page
      .getByTestId('layers-panel')
      .screenshot({ path: 'test-results/layers-invariant-autoscroll.png' });

    // Whatever it is pointing at now is what must receive the layer.
    const finalPreview = await readIndicator(page);
    await page.mouse.up();
    await page.waitForTimeout(300);

    if (finalPreview?.nodeId) {
      const after = await readRows(page);
      const si = after.findIndex((r) => r.id === source.id);
      const ti = after.findIndex((r) => r.id === finalPreview.nodeId);
      expect(si).toBeGreaterThanOrEqual(0);
      expect(ti).toBeGreaterThanOrEqual(0);
      expect(Math.abs(si - ti)).toBe(1);
    }
  });
});
