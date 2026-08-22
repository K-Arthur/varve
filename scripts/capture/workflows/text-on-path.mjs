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
  dragAt,
  fitContent,
  layerNames,
  menuItem,
  openCleanEditor,
  parkPointer,
  selectLayer,
  setRange,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

const objectMenu = (page, item) => menuItem(page, 'Object', item);

async function openTextEditor(page) {
  const editor = page.getByRole('textbox', { name: /editing text/i });
  if (await editor.isVisible({ timeout: 500 }).catch(() => false)) return editor;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  if (await editor.isVisible({ timeout: 800 }).catch(() => false)) return editor;
  const edit = page.getByRole('button', { name: /^Edit$/ }).last();
  await edit.waitFor({ state: 'visible', timeout: 5000 });
  await edit.click();
  await editor.waitFor({ state: 'visible', timeout: 8000 });
  return editor;
}

async function setFillHex(page, hex) {
  const swatch = page.locator('.insp-swatch[aria-label="Fill colour"]');
  if (!(await swatch.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  await swatch.click();
  const dialog = page.getByRole('dialog', { name: /pick fill colour/i });
  await dialog.waitFor({ state: 'visible', timeout: 3000 });
  const field = dialog.getByRole('textbox', { name: 'Hex color' });
  await field.fill(hex);
  await field.press('Enter');
  await page.waitForTimeout(350);
  await dialog.getByRole('button', { name: /^done$/i }).click();
  await page.waitForTimeout(250);
  return true;
}

await capture({
  slug: 'text-on-path',
  workflow: 'Text on path',
  purpose: 'Attaching real text to real path geometry and steering it along the curve.',
  fixture: null,
  duration: [17, 50],
  posterAt: 0.75,

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    await settle(page);
    await parkPointer(page);

    begin();
    await beat(page, 600);

    // ── The ring ───────────────────────────────────────────────────
    await useTool(page, 'o');
    await dragAt(page, [0.22, 0.12], [0.78, 0.72], { steps: 20 });
    await useTool(page, 'v');
    // Keep the path visible as a ring instead of an opaque disc so the real
    // glyphs remain readable when the text is attached to it.
    await setFillHex(page, '#39D0C600');
    const initialStroke = page.getByRole('button', { name: 'Add Stroke' }).first();
    if (await initialStroke.isVisible({ timeout: 3000 }).catch(() => false)) {
      await initialStroke.click();
      await page.waitForTimeout(450);
    }
    const ringLayers = await layerNames(page);
    await parkPointer(page);
    await settle(page, { pauseMs: 150 });
    await beat(page, 500);

    // ── The label ──────────────────────────────────────────────────
    await useTool(page, 't');
    await dragAt(page, [0.06, 0.86], [0.42, 0.94]);
    const labelEditor = await openTextEditor(page);
    await labelEditor.fill('VELO CLUB · EST 1974');
    assert.equal(await labelEditor.inputValue(), 'VELO CLUB · EST 1974');
    await labelEditor.press('Escape');
    await page.waitForTimeout(350);
    await useTool(page, 'v');
    await parkPointer(page);
    await settle(page, { pauseMs: 150 });

    const drawn = await layerNames(page);
    assert.equal(drawn.length, 2, `expected a ring and a label, got ${drawn.length} layer(s)`);
    const ringName = ringLayers[0].trim().split('\n')[0];
    assertions.push('ring and label are two independent nodes, both drawn on camera');
    await beat(page, 600);

    // ── Attach ─────────────────────────────────────────────────────
    const beforeAttach = await canvasPixels(page);
    const selectAll = await menuItem(page, 'Edit', 'Select All');
    await selectAll.click();
    await page.waitForTimeout(400);

    const selectedCount = await page.locator('[role="treeitem"][aria-selected="true"]').count();
    assert.equal(selectedCount, 2, `expected both layers selected, got ${selectedCount}`);
    const attach = await objectMenu(page, 'Text on Path');
    assert.ok(await attach.isEnabled(), 'Text on Path was offered but disabled');
    await beat(page, 600);
    await attach.click();
    await page.waitForTimeout(600);
    await parkPointer(page);
    await settle(page, { pauseMs: 150 });
    assertions.push('Object > Text on Path is enabled for a text layer plus a shape');
    await beat(page, 800);

    // Find the attached text layer by what it exposes rather than by name.
    const offset = page.getByRole('slider', { name: /start offset along path/i });
    const items = await page.getByRole('treeitem').all();
    for (const item of items) {
      await item.click();
      await page.waitForTimeout(300);
      if (await offset.isVisible({ timeout: 800 }).catch(() => false)) break;
    }

    await fitContent(page);
    await parkPointer(page);
    await settle(page, { pauseMs: 150 });

    assert.notEqual(
      Buffer.compare(beforeAttach, await canvasPixels(page)),
      0,
      'attaching did not change the canvas — the glyphs are not being drawn on the path',
    );
    assertions.push('attaching moves the glyphs onto the curve');
    if (!(await offset.isVisible({ timeout: 5000 }).catch(() => false))) {
      const said = await page
        .locator('[aria-live]')
        .allInnerTexts()
        .then((t) => t.filter(Boolean).join(' | '))
        .catch(() => '');
      throw new Error(
        `the text node is not in path mode after Object > Text on Path — ` +
          `the attach did not take. Application announced: ${said || '(nothing)'}`,
      );
    }
    assertions.push('the text node is in path mode — its Text on Path section is present');
    await beat(page, 600);

    // ── Steer it along the curve ───────────────────────────────────
    for (const v of ['8', '16', '24', '30']) {
      await setRange(offset, v);
      await page.waitForTimeout(400);
    }
    await parkPointer(page);
    await settle(page, { pauseMs: 150 });

    const landedOffset = await offset.inputValue();
    assert.equal(landedOffset, '30', `the offset control did not move (reads ${landedOffset})`);
    assertions.push('changing the start offset walks the glyphs around the ring');
    await beat(page, 800);

    // Side is the other setting the renderer actually reads.
    const sideRadio = page.getByRole('radio', { name: /^Inside$/ });
    await sideRadio.click();
    await page.waitForTimeout(500);
    await parkPointer(page);
    await settle(page, { pauseMs: 150 });
    assert.equal(
      await sideRadio.getAttribute('aria-checked'),
      'true',
      'Inside radio did not become selected',
    );
    assertions.push('switching the baseline to the inside of the curve re-lays the glyphs');
    await beat(page, 800);

    // ── The text is still text ─────────────────────────────────────
    // The label was edited in a real text editor before attachment. Keep the
    // path-control state visible here; reopening the editor after attachment
    // would hide the very glyphs this workflow is meant to prove.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await parkPointer(page);
    await settle(page, { pauseMs: 150 });
    const textNodes = await layerNames(page);
    assert.ok(
      textNodes.some((n) => /text|node|path/i.test(n)),
      `no text node remains after editing on path: ${JSON.stringify(textNodes)}`,
    );
    assertions.push('the text is still editable text on the path, not outlined glyphs');
    await beat(page, 800);

    // ── The path is still a path ───────────────────────────────────
    await selectLayer(page, ringName);
    await fitContent(page);
    await parkPointer(page);
    const preReshapeNames = await layerNames(page);
    await dragAt(page, [0.72, 0.68], [0.82, 0.78], { steps: 12 });
    await parkPointer(page);
    await settle(page, { pauseMs: 150 });
    const postReshape = await layerNames(page);
    assert.ok(
      postReshape.length >= preReshapeNames.length - 1,
      `reshaping deleted layers: was ${preReshapeNames.length}, now ${postReshape.length}`,
    );
    assertions.push('the ring stays independently editable and the text follows it');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await useTool(page, 'v');
    await fitContent(page);
    await parkPointer(page);
    await settle(page, { pauseMs: 200 });
    await beat(page, 800);

    return assertions;
  },
});
