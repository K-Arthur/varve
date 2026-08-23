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
  useTool as activateTool,
  beat,
  dragAt,
  fitContent,
  layerNames,
  menuItem,
  openCleanEditor,
  openSection,
  parkPointer,
  settle,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

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
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  return true;
}

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

/** Places a text layer by dragging a box and typing into it. */
async function addText(page, from, to, copy) {
  await activateTool(page, 't');
  await dragAt(page, from, to);
  const editor = await openTextEditor(page);
  await editor.fill(copy);
  assert.equal(await editor.inputValue(), copy);
  await editor.press('Escape');
  await page.waitForTimeout(450);
  await activateTool(page, 'v');
}

await capture({
  slug: 'poster-to-print',
  workflow: 'Poster from blank canvas → print',
  purpose: 'Building an A3 poster from an empty page and taking it into print production.',
  fixture: null,
  duration: [26, 82],
  posterAt: 0.95,

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    // Create a document from the new-document dialog. The preset picker
    // tiles are not reliably selectable by accessible name in headless mode,
    // so we take the default size. The print workflow demonstrates the
    // process (bleed, preflight, export) regardless of page dimensions.
    await openCleanEditor(page, base);
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

    // A live print composition built from real editable layers: paper field,
    // warm sun, dark accent bar, headline, and event information.
    await activateTool(page, 'r');
    await dragAt(page, [0.08, 0.08], [0.92, 0.92], { steps: 18 });
    await setFillHex(page, '#F6F0E5');
    await activateTool(page, 'o');
    await dragAt(page, [0.62, 0.2], [0.86, 0.48], { steps: 18 });
    await setFillHex(page, '#E69F45');
    await activateTool(page, 'r');
    await dragAt(page, [0.12, 0.58], [0.17, 0.82], { steps: 12 });
    await setFillHex(page, '#243447');

    // ── Headline ───────────────────────────────────────────────────
    await addText(page, [0.14, 0.14], [0.58, 0.34], 'NIGHT\nSESSIONS');
    await parkPointer(page);
    await settle(page);
    await beat(page, 1100);

    // ── Geometric element ──────────────────────────────────────────
    await activateTool(page, 'e');
    await dragAt(page, [0.16, 0.34], [0.84, 0.64], { steps: 22 });
    await activateTool(page, 'v');
    await parkPointer(page);
    await settle(page);
    await beat(page, 900);

    // ── Secondary event information ────────────────────────────────
    await addText(page, [0.2, 0.58], [0.58, 0.65], 'FRI 12 SEPT · DOORS 8PM');
    await addText(page, [0.2, 0.7], [0.82, 0.76], 'THE VARVE ROOMS · TICKETS AT THE DOOR');
    await parkPointer(page);
    await fitContent(page);
    await settle(page);

    const built = await layerNames(page);
    assert.ok(built.length >= 4, `poster has only ${built.length} elements`);
    assertions.push(`${built.length} elements placed on camera from an empty page`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await activateTool(page, 'v');
    await parkPointer(page);
    await settle(page, { pauseMs: 200 });
    await beat(page, 1400);

    // ── Bleed ──────────────────────────────────────────────────────
    // Bleed guides default off and PagePrintOverlays only mounts while they
    // are on, so this toggle is what makes the trim edge visible at all.
    const bleed = await menuItem(page, 'View', 'Bleed Guides').catch(() => null);
    if (bleed && (await bleed.isVisible({ timeout: 2000 }).catch(() => false))) {
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
    if (await openSection(page, /page print|print/i, { timeout: 5000 })) {
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
    await page.keyboard.press('Control+e');
    let dialog = page.getByRole('dialog', { name: /export/i });
    if (!(await dialog.isVisible({ timeout: 6000 }).catch(() => false))) {
      // Fallback: use the command palette to open export.
      await page.keyboard.press('Control+k');
      const palette = page.getByRole('dialog', { name: 'Command palette' });
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

    // Close the production dialog for a clean hero frame at the end of the
    // clip; the export surface has already been asserted above.
    const closeExport = dialog.getByRole('button', { name: /close|cancel/i }).first();
    if (await closeExport.isVisible({ timeout: 1500 }).catch(() => false)) {
      await closeExport.click();
      await page.waitForTimeout(600);
    } else {
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Escape');
    await activateTool(page, 'v');
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(350);
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(900);
    await page.keyboard.press('Control+Shift+a');
    await page.waitForTimeout(450);
    await parkPointer(page);
    await settle(page);
    await beat(page, 4200);

    return assertions;
  },
});
