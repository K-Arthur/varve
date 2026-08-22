#!/usr/bin/env node
/**
 * Video E — Variable font axes.
 *
 * Concept: an editorial type specimen. Fraunces is the subject because it is
 * the one bundled family with two axes the loaded build genuinely varies —
 * optical size 9-144 and weight 100-900, read from its own fvar table.
 *
 *   node scripts/capture/workflows/variable-font.mjs
 */
import { strict as assert } from 'node:assert';
import {
  beat,
  canvasPixels,
  dragAt,
  layerNames,
  openCleanEditor,
  parkPointer,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

/** Sets the family through the inspector's own font control. */
async function chooseFamily(page, family) {
  const combo = page.getByRole('combobox', { name: /font/i }).first();
  await combo.click();
  await combo.fill(family);
  await page.waitForTimeout(700);
  await page
    .getByRole('option', { name: new RegExp(family, 'i') })
    .first()
    .click();
  await page.waitForTimeout(800);
}

const axis = (page, label) => page.getByRole('slider', { name: label });

/**
 * Opens a disclosure section only if it is closed.
 *
 * The trigger is a toggle, so clicking unconditionally shuts a section that
 * some earlier step already opened — which reads as "the control is missing"
 * when the sliders inside it then never appear.
 */
async function openSection(page, name) {
  const trigger = page.getByRole('button', { name }).first();
  if (!(await trigger.isVisible({ timeout: 8000 }).catch(() => false))) return false;
  if ((await trigger.getAttribute('aria-expanded')) === 'false') {
    await trigger.click();
    await page.waitForTimeout(500);
  }
  return true;
}

await capture({
  slug: 'variable-font',
  workflow: 'Variable font axes',
  purpose: 'Reading a font’s real variation axes and moving them on live glyphs.',
  fixture: null,
  duration: [15, 26],

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    await settle(page);

    // Set the specimen up before the cut: this clip is about the axes, not
    // about typing.
    await useTool(page, 't');
    await dragAt(page, [0.08, 0.3], [0.9, 0.56]);
    await page.keyboard.type('Aa', { delay: 40 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await useTool(page, 'v');
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(400);
    await chooseFamily(page, 'Fraunces Variable');
    await parkPointer(page);
    await settle(page);

    assert.equal((await layerNames(page)).length, 1, 'expected a single specimen layer');
    // Assert the family actually took. Without this a silent failure in the
    // font picker surfaces much later as "the axis slider is missing", which
    // points at the wrong thing entirely.
    const chosen = await page
      .getByRole('combobox', { name: /font/i })
      .first()
      .inputValue()
      .catch(() => '');
    assert.match(chosen, /Fraunces/i, `font family did not take (inspector reads "${chosen}")`);

    begin();
    await beat(page, 1100);

    // ── Open the axis controls ─────────────────────────────────────
    if (!(await openSection(page, /variable font axes/i))) {
      throw new Error('Variable Font Axes section is not offered for Fraunces Variable');
    }
    await parkPointer(page);
    assertions.push('the inspector offers a Variable Font Axes section for a bundled family');
    await beat(page, 1000);

    // The panel must list exactly what this font declares. Fraunces varies
    // opsz and wght; a generic axis list would also have offered slnt, ital
    // and the rest of the standard tag table.
    const weight = axis(page, /Weight \(wght\)/);
    const optical = axis(page, /Optical Size \(opsz\)/);
    await weight.waitFor({ state: 'visible', timeout: 6000 });
    await optical.waitFor({ state: 'visible', timeout: 6000 });
    assert.equal(
      await page.getByRole('slider', { name: /Slant|Italic|Grade/ }).count(),
      0,
      'panel offered axes the font does not declare',
    );
    assertions.push('exactly the two axes Fraunces declares are shown — opsz and wght');

    // Ranges must come from the font's fvar, not the generic per-tag table.
    assert.equal(await weight.getAttribute('min'), '100', 'wght min is not the font’s');
    assert.equal(await weight.getAttribute('max'), '900', 'wght max is not the font’s');
    assert.equal(await optical.getAttribute('min'), '9', 'opsz min is not the font’s');
    assert.equal(await optical.getAttribute('max'), '144', 'opsz max is not the font’s');
    assertions.push('axis bounds match the fvar table (wght 100-900, opsz 9-144)');
    await beat(page, 1200);

    // ── Move the first axis ────────────────────────────────────────
    // Fraunces defaults wght to 900, so the sweep runs *down* — ending on the
    // default would leave the glyphs exactly as they started and prove nothing.
    const beforeWeight = await canvasPixels(page);
    for (const v of ['700', '500', '300', '200']) {
      await weight.fill(v);
      await page.waitForTimeout(280);
    }
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeWeight, await canvasPixels(page)),
      0,
      'moving wght did not change the rendered glyphs',
    );
    assertions.push('moving wght changed the rendered glyph outlines');
    await beat(page, 1200);

    // ── Move the second ────────────────────────────────────────────
    const beforeOptical = await canvasPixels(page);
    for (const v of ['40', '90', '144']) {
      await optical.fill(v);
      await page.waitForTimeout(300);
    }
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeOptical, await canvasPixels(page)),
      0,
      'moving opsz did not change the rendered glyphs',
    );
    assertions.push('moving opsz changed them again, on the same text');
    await beat(page, 1300);

    // ── Values survive a deselect/reselect round trip ──────────────
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(700);
    await openSection(page, /variable font axes/i);
    assert.equal(await axis(page, /Weight \(wght\)/).inputValue(), '200', 'wght did not persist');
    assert.equal(await axis(page, /Optical Size \(opsz\)/).inputValue(), '144', 'opsz did not persist');
    assertions.push('both values survived deselecting and reselecting the layer');
    await beat(page, 1000);

    // ── Reset one axis to the font default ─────────────────────────
    const beforeReset = await canvasPixels(page);
    await page.getByRole('button', { name: /Reset Weight to default/i }).click();
    await page.waitForTimeout(700);
    await parkPointer(page);
    await settle(page);
    // Fraunces' own wght default is 900, not the generic table's 400 — the
    // reset target is read from the font.
    assert.equal(
      await axis(page, /Weight \(wght\)/).inputValue(),
      '900',
      'reset did not return wght to the font default',
    );
    assert.notEqual(
      Buffer.compare(beforeReset, await canvasPixels(page)),
      0,
      'reset did not redraw the glyphs',
    );
    assertions.push('reset returns wght to 900 — the value this font declares, not a generic 400');

    await parkPointer(page);
    await settle(page);
    await beat(page, 1300);

    return assertions;
  },
});
