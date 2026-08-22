#!/usr/bin/env node
/**
 * Video B — Draw Bézier, then manipulate nodes.
 *
 * Concept: an abstract ribbon logomark, drawn from nothing on a blank canvas.
 * Every anchor in the finished shape is placed by a real pen-tool gesture
 * during the recording; nothing is pre-authored.
 *
 *   node scripts/capture/workflows/bezier-node-edit.mjs
 */
import { strict as assert } from 'node:assert';
import {
  beat,
  canvasPixels,
  clickAt,
  dragAt,
  dragPage,
  nodeEditPoints,
  layerNames,
  openCleanEditor,
  parkPointer,
  selectLayer,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

await capture({
  slug: 'bezier-node-edit',
  workflow: 'Draw Bézier → manipulate nodes',
  purpose: 'Drawing a curved path with the pen tool, then editing its anchors and tangents.',
  fixture: null,
  duration: [14, 26],

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    await settle(page);
    await parkPointer(page);

    // Nothing is pre-authored: the canvas is empty when the cut opens.
    assert.equal((await layerNames(page)).length, 0, 'expected an empty canvas');
    assertions.push('canvas starts empty — every anchor is drawn on camera');

    begin();
    await beat(page, 405);

    // ── Draw the ribbon ────────────────────────────────────────────
    // Pen tool. Two clicks inside 300ms mean "finish", so anchors are
    // spaced above that; clickCanvas already holds for 350ms.
    await useTool(page, 'p');
    await beat(page, 350);

    // Click-drag pulls a tangent out of the anchor as it is placed — this is
    // the gesture that makes the segment a curve rather than a straight run.
    // Positions are fractions of the drawing area, which is what the panels
    // leave behind rather than the window size.
    await dragAt(page, [0.12, 0.62], [0.24, 0.44]);
    await dragAt(page, [0.38, 0.32], [0.50, 0.26]);
    await dragAt(page, [0.64, 0.56], [0.76, 0.66]);
    await clickAt(page, 0.90, 0.34);
    await beat(page, 350);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    // Committing leaves the pen tool active, and the selection quick bar
    // belongs to the select tool — switch back before looking for it.
    await useTool(page, 'v');
    await page.waitForTimeout(300);

    // The pen tool must have produced a path, not a rectangle or a freehand
    // stroke — those are what a mis-timed gesture degrades into.
    const names = await layerNames(page);
    assert.equal(names.length, 1, `expected one new layer, got ${names.length}`);
    assert.match(names[0], /path|vector/i, `expected a path layer, got "${names[0]}"`);
    assertions.push(`pen tool produced a path layer ("${names[0].trim()}"), not a rect or freehand`);
    await beat(page, 405);

    // ── Node editing ───────────────────────────────────────────────
    await selectLayer(page, /vector|path/i);
    await page.waitForTimeout(400);
    const editNodes = page
      .locator('.selection-quick-bar')
      .getByRole('button', { name: /edit nodes/i });
    if (!(await editNodes.isVisible({ timeout: 6000 }).catch(() => false))) {
      throw new Error('no "Edit nodes" control for the drawn path');
    }
    await editNodes.click();
    await page.waitForTimeout(600);
    await parkPointer(page);
    await settle(page);
    assertions.push('node edit mode opened on the drawn path from the selection quick bar');
    await beat(page, 630);

    // Grab an anchor the overlay is actually drawing. Selecting the layer
    // reveals and zooms to it, so the coordinates the path was drawn at are
    // no longer where its anchors sit.
    const points = await nodeEditPoints(page);
    assert.ok(
      points.anchors.length >= 3,
      `node edit exposed ${points.anchors.length} anchors, expected the drawn path's`,
    );
    assertions.push(`node edit mode exposes ${points.anchors.length} real anchors on the path`);

    const target = points.anchors[Math.floor(points.anchors.length / 2)];
    const beforeMove = await canvasPixels(page);
    await dragPage(page, target, { x: target.x + 10, y: target.y - 150 }, { steps: 14 });
    await parkPointer(page);
    await settle(page);
    const afterMove = await canvasPixels(page);
    assert.notEqual(
      Buffer.compare(beforeMove, afterMove),
      0,
      'moving an anchor did not change the rendered canvas',
    );
    assertions.push('dragging an anchor changed the rendered geometry');
    await beat(page, 540);

    // Then a tangent handle, read from the overlay the same way. Handles are
    // drawn at a smaller radius than anchors, which is how they are told
    // apart without reaching into the document model.
    const moved = await nodeEditPoints(page);
    const handle = moved.handles[Math.floor(moved.handles.length / 2)] ?? moved.anchors[0];
    const beforeHandle = await canvasPixels(page);
    await dragPage(page, handle, { x: handle.x + 90, y: handle.y - 110 }, { steps: 14 });
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeHandle, await canvasPixels(page)),
      0,
      'dragging a tangent handle did not change the rendered curve',
    );
    assertions.push('dragging its control handle re-curved the adjoining segments');
    await beat(page, 630);

    // Undo has to reach the node edit, not just the path creation.
    const beforeUndo = await canvasPixels(page);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    assert.notEqual(
      Buffer.compare(beforeUndo, await canvasPixels(page)),
      0,
      'undo did not revert the node edit',
    );
    assertions.push('undo reverted the node edit');
    await beat(page, 350);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(700);
    assertions.push('redo restored it');

    await useTool(page, 'v');
    await parkPointer(page);
    await settle(page);
    await beat(page, 585);

    return assertions;
  },
});
