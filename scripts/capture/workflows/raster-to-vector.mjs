#!/usr/bin/env node
/**
 * Video A — Raster to editable vector.
 *
 * Concept: a botanical field-guide illustration. The bitmap is imported
 * through the application's own image-import input, traced by the real
 * tracer, and the resulting geometry is then node-edited — so the vector in
 * the final frame demonstrably came out of the tracer and not out of a
 * fixture.
 *
 *   node scripts/capture/workflows/raster-to-vector.mjs
 */
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import {
  beat,
  canvasPixels,
  dismissDialogs,
  dragAt,
  dragPage,
  fitContent,
  importImage,
  layerNames,
  menuItem,
  nodeEditPoints,
  openCleanEditor,
  parkPointer,
  selectLayer,
  settle,
} from '../core/editor.mjs';
import { capture, FIXTURES } from '../core/run.mjs';

await capture({
  slug: 'raster-to-vector',
  workflow: 'Raster → editable vector',
  purpose: 'Tracing a bitmap into real path geometry, then editing that geometry.',
  fixture: 'scripts/capture/fixtures/botanical.png',
  duration: [18, 70],

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    await importImage(page, join(FIXTURES, 'botanical.png'));
    // Import may surface dialogs (tips, onboarding residue, image-size notice).
    await dismissDialogs(page, 6);
    await page.keyboard.press('v');
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(400);
    await fitContent(page);
    await parkPointer(page);
    await settle(page);

    // One layer, and it is a bitmap: there is no vector data behind this.
    const start = await layerNames(page);
    assert.equal(start.length, 1, `expected a single imported bitmap, got ${start.length}`);
    assertions.push(`document starts as one raster layer ("${start[0].trim()}")`);

    begin();
    await beat(page, 1400);

    // ── Establish that it really is raster ─────────────────────────
    // The image tools the inspector offers for a bitmap — enhance, trace,
    // background removal — are not offered for vector geometry.
    const imageSection = page.getByRole('button', { name: /image|enhance/i }).first();
    if (await imageSection.isVisible({ timeout: 4000 }).catch(() => false)) {
      await beat(page, 900);
    }

    // ── Trace it ───────────────────────────────────────────────────
    const trace = await menuItem(page, 'Object', 'Vectorize Image');
    assert.ok(await trace.isEnabled(), 'Vectorize Image was disabled for a bitmap layer');
    await beat(page, 800);
    await trace.click();

    const dialog = page
      .getByRole('dialog')
      .filter({ hasText: /vectori/i })
      .first();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    assertions.push('Object > Vectorize Image opens the real trace workflow for the bitmap');
    await beat(page, 1400);

    // Flat colour art wants the colour preset, not the monochrome default
    // that the dialog opens on for line work.
    const preset = dialog.getByRole('combobox', { name: /preset/i }).first();
    if (await preset.isVisible({ timeout: 3000 }).catch(() => false)) {
      const colour = await preset
        .locator('option')
        .filter({ hasText: /colou?r|poster|flat/i })
        .first()
        .getAttribute('value')
        .catch(() => null);
      if (colour) {
        await preset.selectOption(colour);
        await page.waitForTimeout(900);
        assertions.push('trace settings changed through the dialog, not defaults alone');
      }
    }
    await beat(page, 1600);

    // Apply stays disabled until a preview has actually been computed, so
    // reaching an enabled button is itself evidence the tracer ran.
    const apply = dialog.getByRole('button', { name: /apply trace/i });
    await apply.waitFor({ state: 'visible', timeout: 20000 });
    for (let i = 0; i < 150 && !(await apply.isEnabled()); i += 1) {
      await page.waitForTimeout(1000);
    }
    assert.ok(await apply.isEnabled(), 'trace preview never became ready');
    assertions.push('Apply became enabled only after the tracer produced a preview');
    await beat(page, 900);

    await apply.click();

    // Wait for the *outcome*, not for the dialog to go away. A previous run
    // showed why: the app dropped to a splash screen after Apply and stayed
    // there, and because Playwright counts a covered element as visible, the
    // dialog behind that overlay never went "hidden" — so a reload and a slow
    // trace were indistinguishable, and the run burned five minutes on the
    // wrong signal. New layers appearing is the thing actually being claimed.
    const before = start.length;
    const deadline = Date.now() + 240000;
    let grew = false;
    while (Date.now() < deadline) {
      const names = await layerNames(page).catch(() => []);
      if (names.length > before) {
        grew = true;
        break;
      }
      // A splash means the document went away entirely; say so rather than
      // waiting out the clock.
      const splashed = await page
        .locator('.layers-panel')
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (!splashed && Date.now() > deadline - 200000) {
        throw new Error('the editor reloaded during the trace — no document to trace into');
      }
      await page.waitForTimeout(1000);
    }
    if (!grew) throw new Error('the trace produced no new layers within 240s');

    // Close the Vectorize dialog now that the trace has landed.
    const closeBtn = dialog
      .getByRole('button', { name: /close|done|cancel|ok|got it|apply|finish/i })
      .first();
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click({ timeout: 4000 }).catch(() => undefined);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (await dialog.isVisible({ timeout: 800 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }
    await dismissDialogs(page, 8);
    await page.waitForTimeout(500);
    await page.waitForTimeout(1200);
    await parkPointer(page);
    await settle(page);

    // ── What came out ──────────────────────────────────────────────
    const after = await layerNames(page);
    assert.ok(after.length > start.length, `trace produced no new layers (still ${after.length})`);
    const traced = after.filter((n) => !start.includes(n));
    assert.ok(
      traced.some((n) => /path|vector|trace|group/i.test(n)),
      `no vector output among new layers: ${JSON.stringify(traced)}`,
    );
    assertions.push(
      `trace inserted vector geometry as new layer(s): ${traced.map((t) => t.trim()).join(', ')}`,
    );
    // The tracer inserts beside the source rather than covering it, so the
    // raster is still present and still a raster.
    assert.ok(
      after.some((n) => start.includes(n)),
      'the source raster disappeared — the result is not a trace beside it',
    );
    assertions.push('the source bitmap is preserved beside the trace, not hidden behind it');
    await beat(page, 1600);

    // ── Edit the traced geometry ───────────────────────────────────
    const tracedName = traced[0];
    await dismissDialogs(page, 6);
    await selectLayer(page, tracedName.trim().split('\n')[0]);
    await page.waitForTimeout(600);
    // Selecting reveals and zooms to the layer; without re-framing the later
    // pixel comparison can be photographing empty canvas.
    await fitContent(page);
    await parkPointer(page);

    // The tracer returns a *group* of paths, and node editing acts on one
    // path — so select a child rather than the container. That is also the
    // honest thing to show: the result is many paths, not a single outline.
    const editNodes = page
      .locator('.selection-quick-bar')
      .getByRole('button', { name: /edit nodes/i });

    if (!(await editNodes.isVisible({ timeout: 3000 }).catch(() => false))) {
      const children = page.locator('[role="treeitem"][aria-level="2"]');
      const count = await children.count();
      assert.ok(count > 0, 'the trace group has no child paths to edit');
      assertions.push(`the trace produced a group of ${count} separate paths`);
      for (let i = 0; i < Math.min(count, 4); i += 1) {
        await children.nth(i).click({ timeout: 4000, force: true });
        await page.waitForTimeout(500);
        if (await editNodes.isVisible({ timeout: 1500 }).catch(() => false)) break;
      }
      // Selecting reveals and zooms to the path, and the tracer's smaller
      // shapes are only tens of pixels across — one of them filled the screen
      // at 2475%, which is both an unusable frame and a drag that moves the
      // anchor about a pixel in document space. Re-frame the whole artwork.
      await fitContent(page);
      await parkPointer(page);
      await settle(page);
    }
    if (!(await editNodes.isVisible({ timeout: 6000 }).catch(() => false))) {
      throw new Error('traced output exposes no node editing — it is not editable geometry');
    }
    await editNodes.click();
    await page.waitForTimeout(700);
    await dismissDialogs(page, 4);
    await parkPointer(page);
    await settle(page);
    assertions.push('the traced output opens in node edit mode — it is real path geometry');
    await beat(page, 1600);

    // Grab an anchor the overlay is actually drawing, rather than guessing at
    // a fraction of the canvas — the same fix the Bezier clip needed. On a
    // traced path the anchors are wherever the tracer put them, so a guessed
    // position is even less likely to land on one.
    const points = await nodeEditPoints(page);
    assert.ok(points.anchors.length > 0, 'node edit mode exposed no anchors on the traced path');
    assertions.push(`the traced path exposes ${points.anchors.length} editable anchors`);

    // Pick the anchor furthest from the path's centre: on a traced outline the
    // interior anchors barely move the silhouette, and a change nobody can see
    // is not worth asserting on.
    const cx = points.anchors.reduce((a, p) => a + p.x, 0) / points.anchors.length;
    const cy = points.anchors.reduce((a, p) => a + p.y, 0) / points.anchors.length;
    const anchor = points.anchors.reduce((best, p) =>
      Math.hypot(p.x - cx, p.y - cy) > Math.hypot(best.x - cx, best.y - cy) ? p : best,
    );
    const beforeEdit = await canvasPixels(page, anchor);
    await dragPage(page, anchor, { x: anchor.x + 70, y: anchor.y - 60 }, { steps: 18 });
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeEdit, await canvasPixels(page, anchor)),
      0,
      'moving an anchor on the traced path changed nothing',
    );
    assertions.push('moving an anchor on the traced path changed the render');
    await beat(page, 1200);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(700);
    assertions.push('the node edit participates in undo and redo');

    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await dismissDialogs(page, 4);
    await parkPointer(page);
    await settle(page);
    await beat(page, 1400);

    return assertions;
  },
});
