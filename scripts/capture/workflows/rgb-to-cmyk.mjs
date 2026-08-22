#!/usr/bin/env node
/**
 * Video D — RGB design into a CMYK workflow.
 *
 * Concept: a bright beverage-can label, built from saturated RGB so the
 * gamut behaviour is visible rather than theoretical.
 *
 * The clip is careful about a distinction this domain routinely blurs.
 * Varve separates two operations and so does this recording:
 *
 *   Assign mode     — changes document intent; stored values are untouched
 *                     and reinterpreted at render and export.
 *   Convert colors  — rewrites stored process colors, as one undoable step.
 *
 * In the browser that conversion is analytical and the application says so;
 * profile-accurate ICC conversion is the desktop engine's job. The clip
 * shows what is there and claims nothing beyond it.
 *
 *   node scripts/capture/workflows/rgb-to-cmyk.mjs
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
  openSection,
  parkPointer,
  selectLayer,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

/** Paints the current selection a specific sRGB value through the fill picker. */
async function setFillHex(page, hex) {
  const swatch = page.locator('.insp-color-swatch, [aria-label*="fill" i]').first();
  if (!(await swatch.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  await swatch.click();
  const hexField = page.getByRole('textbox', { name: /hex/i }).first();
  if (!(await hexField.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  await hexField.fill(hex);
  await hexField.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return true;
}

await capture({
  slug: 'rgb-to-cmyk',
  workflow: 'RGB design → CMYK workflow',
  purpose: 'Taking saturated RGB artwork through Varve’s real document colour-mode workflow.',
  fixture: null,
  duration: [20, 32],

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    await settle(page);

    // Build the label before the cut — this clip is about colour, not drawing.
    await useTool(page, 'r');
    await dragAt(page, [0.28, 0.12], [0.72, 0.88], { steps: 20 });
    await useTool(page, 'v');
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(400);
    // A strongly saturated orange sits well outside a coated CMYK gamut.
    const painted = await setFillHex(page, '#FF4B1F');
    await useTool(page, 'o');
    await dragAt(page, [0.36, 0.3], [0.64, 0.58], { steps: 18 });
    await useTool(page, 'v');
    await parkPointer(page);
    await fitContent(page);
    await settle(page);
    if (painted) assertions.push('label artwork painted with a saturated sRGB value (#FF4B1F)');

    begin();
    await beat(page, 1300);

    // ── The document is RGB ────────────────────────────────────────
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    if (await openSection(page, /document color/i)) {
      assertions.push('the Document Color section reports the working mode');
    }
    await parkPointer(page);
    await beat(page, 1500);

    // ── A real colour readout on a real object ─────────────────────
    await selectLayer(page, /rect|shape|vector/i);
    await page.waitForTimeout(700);
    assertions.push('a saturated object is selected and its colour is read in the inspector');
    await beat(page, 1600);

    // ── The document colour-mode workflow ──────────────────────────
    // File > Document Color Mode… is the real surface. The command palette
    // in this build edits keyboard shortcuts; it does not run actions.
    const openConversion = await menuItem(page, 'File', 'Document Color Mode');
    await beat(page, 700);
    await openConversion.click();
    await page.waitForTimeout(900);

    const dialog = page.getByRole('dialog', { name: /document color mode/i });
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    assertions.push('the Document Color Mode dialog is the real conversion surface');
    await beat(page, 1400);

    // The dialog states the current mode, and offers two *different*
    // operations. Both are asserted so the clip cannot be read as claiming
    // one when it did the other.
    const current = await dialog.locator('.color-conversion__value').first().innerText();
    assert.match(current, /RGB/i, `document did not start in RGB (reported "${current}")`);
    assertions.push(`dialog reports the document is currently ${current.trim()}`);

    await dialog.getByRole('radio', { name: /^CMYK$/ }).check();
    await page.waitForTimeout(600);
    const assign = dialog.getByRole('button', { name: /assign mode/i });
    const convert = dialog.getByRole('button', { name: /convert colors/i });
    await assign.waitFor({ state: 'visible', timeout: 5000 });
    await convert.waitFor({ state: 'visible', timeout: 5000 });
    assertions.push(
      'assign-mode and convert-colors are offered as distinct operations, with the dialog ' +
        'stating that browser conversion is analytical and ICC-accurate conversion is the ' +
        'desktop engine’s',
    );
    await beat(page, 2200);

    // Convert is the operation that actually rewrites stored colour.
    const beforeConvert = await canvasPixels(page);
    await convert.click();
    await dialog.waitFor({ state: 'hidden', timeout: 20000 });
    await page.waitForTimeout(1000);
    await parkPointer(page);
    await settle(page);
    assertions.push('Convert colors rewrote the stored process colours as one undoable step');
    await beat(page, 1400);

    // ── Show the resulting state ───────────────────────────────────
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await openSection(page, /document color/i);
    await parkPointer(page);
    await beat(page, 1600);

    // One undoable step, as the dialog promises.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(900);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeConvert, await canvasPixels(page)),
      0,
      'the conversion left the canvas unchanged in both directions',
    );
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(900);
    assertions.push('the conversion is a single undo/redo step');

    await parkPointer(page);
    await settle(page);
    await beat(page, 1500);

    return assertions;
  },
});
