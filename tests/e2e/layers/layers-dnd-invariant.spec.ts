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

/**
 * Seed `count` rects and wait until the panel actually shows them. Seeding is
 * canvas-driven, so under load it can fall short — asserting the count here
 * turns that into a clear failure instead of an undefined row index later.
 */
async function seedAndRead(page: Page, count: number, minimum = count): Promise<Row[]> {
  await seedLayers(page, count);
  await expect
    .poll(async () => page.getByRole('treeitem').count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(minimum);
  return readRows(page);
}

/**
 * Grow the tree to at least `target` rows by duplicating the selection rather
 * than drawing every shape on the canvas. Canvas seeding costs a tool switch
 * and a three-move pointer drag per layer, which is the least reliable thing
 * in this suite under load; duplication doubles the count per keystroke.
 */
async function seedManyLayers(page: Page, target: number): Promise<number> {
  await seedAndRead(page, 3, 2);
  const tree = page.getByRole('tree', { name: /layers/i });
  let count = await page.getByRole('treeitem').count();
  for (let round = 0; round < 8 && count < target; round++) {
    await tree.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+d');
    // Duplication does not always double (selection can be partial), so grow
    // opportunistically and stop when a round adds nothing rather than
    // failing on an exact arithmetic expectation.
    await page.waitForTimeout(600);
    const next = await page.getByRole('treeitem').count();
    if (next <= count) break;
    count = next;
  }
  return count;
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
    const rows = await seedAndRead(page, 4);
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
    const rows = await seedAndRead(page, 4);
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
    let rows = await seedAndRead(page, 4);
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
    await seedAndRead(page, 2);
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
    await seedAndRead(page, 2);
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
    const rows = await seedAndRead(page, 6, 4);
    const source = rows[0]!;
    const target = rows[rows.length - 1]!;

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
    await seedAndRead(page, 2);
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
    const rows = await seedAndRead(page, 3);
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
    const rows = await seedAndRead(page, 3);
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
    const rows = await seedAndRead(page, 3);
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
    // Enough rows to overflow the panel so the tree genuinely scrolls. Seeded
    // through the paced helper rather than a tight canvas loop: an unpaced
    // loop outruns the app under load and the document never opens.
    const rowCount = await seedManyLayers(page, 24);
    // The panel shows roughly nine rows, so anything past a dozen scrolls.
    expect(rowCount).toBeGreaterThan(12);

    const tree = page.getByRole('tree', { name: /layers/i });
    await expect
      .poll(async () => tree.evaluate((el) => el.scrollHeight > el.clientHeight + 8), {
        timeout: 30_000,
      })
      .toBe(true);

    const rows = await readRows(page);
    const source = rows[0]!;
    // seedManyLayers grows the tree with Ctrl+A / Ctrl+D, which leaves the
    // whole tree selected — and dragging a selected row carries the entire
    // selection. Narrow it to one row so this exercises a single-node move.
    await page.locator(`[role="treeitem"][data-node-id="${source.id}"]`).click();
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1);
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
    expect(await readIndicator(page)).not.toBeNull();
    await page
      .getByTestId('layers-panel')
      .screenshot({ path: 'test-results/layers-invariant-autoscroll.png' });

    // Leave the edge band so scrolling stops, and wait for it to settle. The
    // target is re-resolved every frame while auto-scroll runs — by design,
    // since the rows move under a stationary cursor — so reading a preview
    // mid-scroll and releasing a moment later compares two different frames.
    await page.mouse.move(treeBox.x + treeBox.width / 2, treeBox.y + treeBox.height / 2);
    // Let the pointer move be processed and the rAF loop notice it has left
    // the band before sampling, otherwise the first two reads can match while
    // the list is still moving.
    await page.waitForTimeout(300);
    await expect
      .poll(
        async () => {
          const a = await tree.evaluate((el) => el.scrollTop);
          await page.waitForTimeout(150);
          const b = await tree.evaluate((el) => el.scrollTop);
          await page.waitForTimeout(150);
          const c = await tree.evaluate((el) => el.scrollTop);
          return a === b && b === c;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    // Aim at a point well inside the viewport rather than picking a row by
    // index: after scrolling, `readRows` also returns overscan rows that are
    // mounted but clipped out of view, and the resolver correctly refuses a
    // pointer that is outside the tree.
    const aimY = treeBox.y + treeBox.height * 0.6;
    await page.mouse.move(treeBox.x + treeBox.width / 2, aimY, { steps: 4 });
    await page.mouse.move(treeBox.x + treeBox.width / 2, aimY);

    // Whatever the panel is now pointing at is what must receive the layer —
    // and it has to be a row auto-scroll brought into view, not the one the
    // drag started from.
    const finalPreview = await readIndicator(page);
    expect(finalPreview, 'an indicator after auto-scroll settles').not.toBeNull();
    const targetId = finalPreview?.nodeId;
    expect(targetId).toBeTruthy();
    expect(targetId).not.toBe(source.id);
    const zone = finalPreview?.zone;
    await page.mouse.up();

    // Compare `aria-posinset`, not positions within `readRows`. That helper
    // reports the mounted window, and in a virtualized tree a row can drop out
    // of it — posinset is the row's index in the whole list, so it stays
    // meaningful however the panel has scrolled.
    const posOf = async (id: string): Promise<number | null> => {
      const row = page.locator(`[role="treeitem"][data-node-id="${id}"]`);
      await row.scrollIntoViewIfNeeded().catch(() => undefined);
      const v = await row.getAttribute('aria-posinset').catch(() => null);
      return v == null ? null : Number(v);
    };

    await expect
      .poll(async () => {
        const sp = await posOf(source.id);
        const tp = await posOf(targetId!);
        return sp != null && tp != null ? sp - tp : null;
      })
      .toBe(zone === 'before' ? -1 : 1);
  });
});
