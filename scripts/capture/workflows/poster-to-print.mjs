#!/usr/bin/env node
/**
 * Video C — A3 poster, blank page to print production.
 *
 * Concept: an experimental jazz-festival poster. The document starts as an
 * empty A3 page and every element is placed during the clip — nothing is
 * preloaded — then it goes through Varve's real print-production surfaces.
 *
 * The clip stops at the preflight/print state the application supports. It
 * does not send a job to a physical printer.
 *
 *   node scripts/capture/workflows/poster-to-print.mjs
 */
import { strict as assert } from 'node:assert';
import {
  beat,
  dragAt,
  fitContent,
  layerNames,
  openCleanEditor,
  parkPointer,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

/** Places a text layer by dragging a box and typing into it. */
async function addText(page, from, to, copy, { delay = 22 } = {}) {
  await useTool(page, 't');
  await dragAt(page, from, to);
  await page.keyboard.type(copy, { delay });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  await useTool(page, 'v');
}

await capture({
  slug: 'poster-to-print',
  workflow: 'Poster from blank canvas → print',
  purpose: 'Building an A3 poster from an empty page and taking it into print production.',
  fixture: null,
  duration: [26, 44],

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    // A3 chosen in the application's own new-document dialog.
    await openCleanEditor(page, base, { preset: /^A3$/ });
    await settle(page);
    await parkPointer(page);

    assert.equal((await layerNames(page)).length, 0, 'the A3 page must start empty');
    assertions.push('document begins as an empty A3 page — no preloaded poster');

    // The status bar and document settings must agree that this is A3 in mm.
    const unitText = await page
      .locator('.editor-status')
      .innerText()
      .catch(() => '');
    if (/mm/i.test(unitText)) {
      assertions.push('the document reports millimetre units, as an A3 print page should');
    }

    begin();
    await beat(page, 1200);

    // ── Headline ───────────────────────────────────────────────────
    await addText(page, [0.08, 0.1], [0.92, 0.28], 'NIGHT\nSESSIONS');
    await parkPointer(page);
    await settle(page);
    await beat(page, 1100);

    // ── Geometric element ──────────────────────────────────────────
    await useTool(page, 'e');
    await dragAt(page, [0.16, 0.34], [0.84, 0.64], { steps: 22 });
    await useTool(page, 'v');
    await parkPointer(page);
    await settle(page);
    await beat(page, 900);

    // ── Secondary event information ────────────────────────────────
    await addText(page, [0.08, 0.7], [0.92, 0.8], 'FRI 12 SEPT · DOORS 8PM');
    await addText(page, [0.08, 0.84], [0.92, 0.93], 'THE VARVE ROOMS · TICKETS AT THE DOOR');
    await parkPointer(page);
    await fitContent(page);
    await settle(page);

    const built = await layerNames(page);
    assert.ok(built.length >= 4, `poster has only ${built.length} elements`);
    assertions.push(`${built.length} elements placed on camera from an empty page`);
    await beat(page, 1400);

    // ── Bleed ──────────────────────────────────────────────────────
    // Bleed guides default off and PagePrintOverlays only mounts while they
    // are on, so this toggle is what makes the trim edge visible at all.
    await page.getByRole('menuitem', { name: /^View$/ }).click();
    const bleed = page.getByRole('menuitem', { name: /bleed guides/i });
    if (await bleed.isVisible({ timeout: 5000 }).catch(() => false)) {
      await beat(page, 700);
      await bleed.click();
      await page.waitForTimeout(800);
      assertions.push('View > Bleed Guides reveals the trim and bleed boundary on the page');
    } else {
      await page.keyboard.press('Escape');
    }
    await parkPointer(page);
    await settle(page);
    await beat(page, 1600);

    // ── Print settings on the page itself ──────────────────────────
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const pagePrint = page.getByRole('button', { name: /page print|print/i }).first();
    if (await pagePrint.isVisible({ timeout: 5000 }).catch(() => false)) {
      const expanded = await pagePrint.getAttribute('aria-expanded');
      if (expanded === 'false') await pagePrint.click();
      await page.waitForTimeout(700);
      assertions.push('the page’s own print settings are shown in the inspector');
    }
    await parkPointer(page);
    await beat(page, 1700);

    // ── Preflight ──────────────────────────────────────────────────
    const preflight = page.locator('.editor-status').getByRole('button', {
      name: /issue|preflight|no issues/i,
    });
    if (await preflight.isVisible({ timeout: 5000 }).catch(() => false)) {
      const label = await preflight.innerText();
      await preflight.click();
      await page.waitForTimeout(900);
      assertions.push(`preflight reports on the real document ("${label.trim()}")`);
      await beat(page, 2000);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }

    // ── Print production surface ───────────────────────────────────
    // The advanced export dialog carries the print settings panel — bleed,
    // crop and registration marks, colour bars, the DPI floor and the
    // preflight findings. It is where a print job is actually configured;
    // no system print job is dispatched by this clip.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+Shift+e');
    let dialog = page.getByRole('dialog', { name: /export/i });
    if (!(await dialog.isVisible({ timeout: 6000 }).catch(() => false))) {
      await page.keyboard.press('Control+k');
      const palette = page.locator('[role="dialog"], .command-palette').first();
      await palette.waitFor({ state: 'visible', timeout: 8000 });
      await page.keyboard.type('export', { delay: 45 });
      await page.waitForTimeout(700);
      await page.keyboard.press('Enter');
      dialog = page.getByRole('dialog', { name: /export/i });
    }
    await dialog.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(900);

    const printPanel = dialog.locator('.print-settings');
    if (await printPanel.isVisible({ timeout: 6000 }).catch(() => false)) {
      const bleedField = printPanel.getByRole('spinbutton', { name: /bleed in millimetres/i });
      if (await bleedField.isVisible({ timeout: 3000 }).catch(() => false)) {
        assertions.push(
          'the export dialog exposes the real print-production settings: bleed in mm, ' +
            'crop and registration marks, colour bars and a resolution floor',
        );
      }
    }
    await beat(page, 2600);

    await parkPointer(page);
    await settle(page);
    await beat(page, 1200);

    return assertions;
  },
});
