#!/usr/bin/env node
/**
 * Video E — Variable font axes.
 *
 * Concept: an editorial type specimen, set in the family a new text node
 * already carries — IBM Plex Sans Variable, one of the three variable fonts
 * the application bundles. Its weight axis spans 100-700, read from its own
 * fvar table rather than from a generic per-tag default of 1-1000.
 *
 * Until this branch the panel could not appear for any bundled family, so
 * the specimen needing no font change is the point rather than a shortcut.
 *
 *   node scripts/capture/workflows/variable-font.mjs
 */
import { strict as assert } from 'node:assert';
import {
  beat,
  canvasPixels,
  dragAt,
  fitContent,
  layerNames,
  openCleanEditor,
  openSection,
  parkPointer,
  setRange,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

const axis = (page, label) => page.getByRole('slider', { name: label });

await capture({
  slug: 'variable-font',
  workflow: 'Variable font axes',
  purpose: 'Reading a font’s real variation axes from its fvar and moving them on live glyphs.',
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
    // Selecting reveals and zooms to the layer; fit so the specimen is framed
    // the same way on every run and the comparisons look at the glyphs.
    await fitContent(page);
    await parkPointer(page);
    await settle(page);

    assert.equal((await layerNames(page)).length, 1, 'expected a single specimen layer');

    // The specimen is set in the family a new text node already carries. That
    // is the point rather than a shortcut: IBM Plex Sans Variable is one of
    // the three variable families the app bundles, and until the registry
    // learned their fvar axes this panel could not appear for any of them.
    const family = await page
      .getByRole('combobox', { name: /font/i })
      .first()
      .inputValue()
      .catch(() => '');
    assert.match(family, /Variable/i, `expected a bundled variable family, got "${family}"`);
    assertions.push(`specimen is set in ${family.trim()}, a font the application bundles`);

    begin();
    await beat(page, 1650);

    // ── Open the axis controls ─────────────────────────────────────
    if (!(await openSection(page, /variable font axes/i))) {
      throw new Error('Variable Font Axes section is not offered for a bundled variable family');
    }
    await parkPointer(page);
    assertions.push('the inspector offers a Variable Font Axes section for a bundled family');
    await beat(page, 1500);

    // The panel must list exactly what this font declares.
    const weight = axis(page, /Weight \(wght\)/);
    await weight.waitFor({ state: 'visible', timeout: 8000 });

    // Only what this font declares. The loaded IBM Plex Sans build varies
    // weight and nothing else; before this branch the panel fell back to the
    // full standard tag table and offered sliders the shaper discards.
    assert.equal(
      await page.getByRole('slider', { name: /Slant|Optical Size|Grade|Width/ }).count(),
      0,
      'panel offered axes the font does not declare',
    );
    assertions.push('only the wght axis is offered — the one this font actually varies');

    // Bounds come from the font's own fvar, not the generic per-tag table.
    assert.equal(await weight.getAttribute('min'), '100', 'wght min is not the font’s');
    assert.equal(
      await weight.getAttribute('max'),
      '700',
      'wght max is not the font’s — the generic table would say 1000',
    );
    assertions.push('wght spans 100-700, read from the fvar table; the generic table says 1-1000');
    await beat(page, 1800);

    // ── Move the first axis ────────────────────────────────────────
    // Defaults to 400, so the sweep runs to the ends of the range rather than
    // stopping on the default, which would leave the glyphs as they started.
    const beforeWeight = await canvasPixels(page);
    // Ends heavy. A light terminal value is the one case a fallback face
    // renders indistinguishably from the 400 default — there is no synthetic
    // thinning — so a real failure and a font-loading problem would look the
    // same in the pixel comparison below.
    for (const v of ['250', '400', '550', '700']) {
      await setRange(weight, v);
      await page.waitForTimeout(460);
    }
    await parkPointer(page);
    await settle(page);

    // Separate the two failures this used to conflate. If the control never
    // moved, saying so beats reporting that the glyphs did not change — they
    // would not have, and the message would point at the renderer.
    const landed = await weight.inputValue();
    if (landed !== '700') {
      // Dump enough to tell apart: wrong element matched, a range the value
      // is being clamped into, or a write that never reached the node.
      const all = await page.getByRole('slider').all();
      const dump = [];
      for (const sl of all) {
        dump.push(
          `${await sl.getAttribute('aria-label')}[min=${await sl.getAttribute('min')} ` +
            `max=${await sl.getAttribute('max')} value=${await sl.inputValue()}]`,
        );
      }
      throw new Error(
        `the weight control did not move (reads ${landed}). Sliders present: ${dump.join(', ')}`,
      );
    }
    assert.notEqual(
      Buffer.compare(beforeWeight, await canvasPixels(page)),
      0,
      `the control moved to ${landed} but the rendered glyphs did not change`,
    );
    assertions.push('moving wght changed the rendered glyph outlines');
    await beat(page, 1800);

    // ── Values survive a deselect/reselect round trip ──────────────
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(700);
    await openSection(page, /variable font axes/i);
    const persisted = await axis(page, /Weight \(wght\)/).inputValue();
    assert.equal(persisted, '700', `wght did not persist across reselect (reads ${persisted})`);
    assertions.push('the axis value survived deselecting and reselecting the layer');
    await beat(page, 1500);

    // ── Reset one axis to the font default ─────────────────────────
    const beforeReset = await canvasPixels(page);
    await page.getByRole('button', { name: /Reset Weight to default/i }).click();
    await page.waitForTimeout(700);
    await parkPointer(page);
    await settle(page);
    assert.equal(
      await axis(page, /Weight \(wght\)/).inputValue(),
      '400',
      'reset did not return wght to the font default',
    );
    assert.notEqual(
      Buffer.compare(beforeReset, await canvasPixels(page)),
      0,
      'reset did not redraw the glyphs',
    );
    assertions.push('reset returns wght to the value this font declares as its default');

    await parkPointer(page);
    await settle(page);
    await beat(page, 1950);

    return assertions;
  },
});
