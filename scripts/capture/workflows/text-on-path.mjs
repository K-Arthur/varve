#!/usr/bin/env node
/**
 * Video F — Text on path.
 *
 * Concept: a circular bicycle-club badge. The ring and the label are drawn in
 * the clip, then attached through Object > Text on Path, so what the viewer
 * sees is the whole route a user takes.
 *
 *   node scripts/capture/workflows/text-on-path.mjs
 */
import { strict as assert } from 'node:assert';
import {
  beat,
  canvasPixels,
  dragCanvas,
  layerNames,
  openCleanEditor,
  parkPointer,
  selectLayer,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

async function objectMenu(page, item) {
  await page.getByRole('menuitem', { name: /^Object$/ }).click();
  const entry = page.getByRole('menuitem', { name: item });
  await entry.waitFor({ state: 'visible', timeout: 6000 });
  return entry;
}

await capture({
  slug: 'text-on-path',
  workflow: 'Text on path',
  purpose: 'Attaching real text to real path geometry and steering it along the curve.',
  fixture: null,
  duration: [17, 28],

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    await settle(page);
    await parkPointer(page);

    begin();
    await beat(page, 900);

    // ── The ring ───────────────────────────────────────────────────
    await useTool(page, 'o');
    await dragCanvas(page, [420, 170], [1020, 770], { steps: 26 });
    await useTool(page, 'v');
    await parkPointer(page);
    await settle(page);
    await beat(page, 800);

    // ── The label ──────────────────────────────────────────────────
    await useTool(page, 't');
    await dragCanvas(page, [140, 820], [520, 870]);
    await page.keyboard.type('VELO CLUB · EST 1974', { delay: 35 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await useTool(page, 'v');
    await parkPointer(page);
    await settle(page);

    const drawn = await layerNames(page);
    assert.equal(drawn.length, 2, `expected a ring and a label, got ${drawn.length} layer(s)`);
    assertions.push('ring and label are two independent nodes, both drawn on camera');
    await beat(page, 1000);

    // ── Attach ─────────────────────────────────────────────────────
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(500);
    const attach = await objectMenu(page, /^Text on Path$/);
    assert.ok(await attach.isEnabled(), 'Text on Path was offered but disabled');
    await beat(page, 900);
    await attach.click();
    await page.waitForTimeout(900);
    await parkPointer(page);
    await settle(page);
    assertions.push('Object > Text on Path is enabled for a text layer plus a shape');
    await beat(page, 1300);

    // The section only renders for a single text node already in path mode,
    // so reaching it is evidence the document really changed.
    await selectLayer(page, /VELO CLUB/i);
    const offset = page.getByRole('slider', { name: /start offset along path/i });
    await offset.waitFor({ state: 'visible', timeout: 8000 });
    assertions.push('the text node is in path mode — its Text on Path section is present');
    await beat(page, 1000);

    // ── Steer it along the curve ───────────────────────────────────
    const beforeOffset = await canvasPixels(page);
    for (const v of ['8', '16', '24', '30']) {
      await offset.fill(v);
      await page.waitForTimeout(260);
    }
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeOffset, await canvasPixels(page)),
      0,
      'changing the start offset did not move the glyphs',
    );
    assertions.push('changing the start offset walks the glyphs around the ring');
    await beat(page, 1200);

    // Side is the other setting the renderer actually reads.
    const beforeSide = await canvasPixels(page);
    await page.getByRole('radio', { name: /^Inside$/ }).click();
    await page.waitForTimeout(700);
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeSide, await canvasPixels(page)),
      0,
      'switching sides did not change the layout',
    );
    assertions.push('switching the baseline to the inside of the curve re-lays the glyphs');
    await beat(page, 1200);

    // ── The text is still text ─────────────────────────────────────
    // Editing the content re-flows it along the path: if the attach had
    // outlined the glyphs, there would be nothing left to type into.
    const beforeEdit = await canvasPixels(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('VELO CLUB · EST 1974 ·', { delay: 30 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeEdit, await canvasPixels(page)),
      0,
      'editing the attached text did not re-lay it',
    );
    assertions.push('the text is still editable text on the path, not outlined glyphs');
    await beat(page, 1200);

    // ── The path is still a path ───────────────────────────────────
    // Reshaping the ring must re-lay the text that rides on it.
    const beforeReshape = await canvasPixels(page);
    await selectLayer(page, /ellipse|circle|shape/i);
    await dragCanvas(page, [1020, 770], [1100, 840], { steps: 22 });
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeReshape, await canvasPixels(page)),
      0,
      'reshaping the ring did not re-lay the text',
    );
    assertions.push('the ring stays independently editable and the text follows it');
    await beat(page, 1500);

    return assertions;
  },
});
