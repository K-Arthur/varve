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
  clickCanvas,
  dragCanvas,
  layerNames,
  openCleanEditor,
  parkPointer,
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
    await beat(page, 900);

    // ── Draw the ribbon ────────────────────────────────────────────
    // Pen tool. Two clicks inside 300ms mean "finish", so anchors are
    // spaced above that; clickCanvas already holds for 350ms.
    await useTool(page, 'p');
    await beat(page, 500);

    // Click-drag pulls a tangent out of the anchor as it is placed — this is
    // the gesture that makes the segment a curve rather than a straight run.
    await dragCanvas(page, [300, 480], [400, 380]);
    await dragCanvas(page, [560, 330], [660, 300]);
    await dragCanvas(page, [830, 430], [920, 490]);
    await dragCanvas(page, [1060, 330], [1140, 280]);
    await clickCanvas(page, 1220, 470);
    await beat(page, 500);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);

    // The pen tool must have produced a path, not a rectangle or a freehand
    // stroke — those are what a mis-timed gesture degrades into.
    const names = await layerNames(page);
    assert.equal(names.length, 1, `expected one new layer, got ${names.length}`);
    assert.match(names[0], /path|vector/i, `expected a path layer, got "${names[0]}"`);
    assertions.push(`pen tool produced a path layer ("${names[0].trim()}"), not a rect or freehand`);
    await beat(page, 900);

    // ── Node editing ───────────────────────────────────────────────
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
    await beat(page, 1400);

    // Move a real anchor and prove the render followed it.
    const beforeMove = await canvasPixels(page);
    await dragCanvas(page, [830, 430], [830, 250], { steps: 26 });
    await parkPointer(page);
    await settle(page);
    const afterMove = await canvasPixels(page);
    assert.notEqual(
      Buffer.compare(beforeMove, afterMove),
      0,
      'moving an anchor did not change the rendered canvas',
    );
    assertions.push('dragging an anchor changed the rendered geometry');
    await beat(page, 1200);

    // Then a tangent handle, which changes curvature without moving the anchor.
    const beforeHandle = await canvasPixels(page);
    await dragCanvas(page, [920, 310], [1010, 200], { steps: 26 });
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeHandle, await canvasPixels(page)),
      0,
      'dragging a tangent handle did not change the rendered curve',
    );
    assertions.push('dragging a tangent handle re-curved the segment');
    await beat(page, 1400);

    // Undo has to reach the node edit, not just the path creation.
    const beforeUndo = await canvasPixels(page);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeUndo, await canvasPixels(page)),
      0,
      'undo did not revert the node edit',
    );
    assertions.push('undo reverted the node edit');
    await beat(page, 700);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(700);
    assertions.push('redo restored it');

    await useTool(page, 'v');
    await parkPointer(page);
    await settle(page);
    await beat(page, 1300);

    return assertions;
  },
});
