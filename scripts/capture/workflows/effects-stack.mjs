#!/usr/bin/env node
/**
 * Video A — Retro editorial portrait treatment.
 *
 * The source is a committed, redistributable fixture. Every operation after
 * the cut begins goes through the adjustment-layer UI; the source bitmap is
 * never replaced by a pre-rendered result.
 */
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import {
  addAdjustment,
  beat,
  canvasPixels,
  createAdjustmentLayer,
  fitContent,
  importImage,
  openCleanEditor,
  parkPointer,
  settle,
} from '../core/editor.mjs';
import { capture, ROOT } from '../core/run.mjs';

const source = join(ROOT, 'tests', 'fixtures', 'bg-removal-corpus', 'human.jpg');

function stackLabels(page) {
  return page.locator('.adj-panel__item-name').allInnerTexts();
}

await capture({
  slug: 'effects-stack',
  workflow: 'Non-destructive effects stack',
  purpose: 'Retro editorial portrait treatment with an editable adjustment stack.',
  fixture: 'tests/fixtures/bg-removal-corpus/human.jpg',
  duration: [22, 34],
  metadata: {
    sourcePixelsRemainRecoverable: true,
    stackKinds: ['blur', 'gradientMap', 'halftone'],
    note: 'Adjustment-layer order is demonstrated within the supported FilterIR stack.',
  },

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    await importImage(page, source);
    await page.getByRole('treeitem').first().click();
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    const original = await canvasPixels(page);
    begin();
    await beat(page, 1200);

    await createAdjustmentLayer(page);
    // New Adjustment Layer currently seeds a Levels entry. Remove that
    // default through its real row control so the filmed stack is explicit.
    const seeded = page.locator('.adj-panel__item-remove').first();
    if (await seeded.isVisible({ timeout: 2000 }).catch(() => false)) await seeded.click();
    await addAdjustment(page, 'Blur');
    console.log(
      '[effects-debug]',
      await page.locator('.adj-panel__item').allInnerTexts(),
      await page.locator('.adj-panel__editor').count(),
      await page.locator('.adj-panel__item-select').first().getAttribute('aria-expanded'),
    );
    await page.getByRole('button', { name: 'Blur', exact: true }).click();
    const blurEditor = page.locator('.adj-panel__editor');
    await blurEditor.waitFor({ state: 'attached', timeout: 5000 });
    await blurEditor.scrollIntoViewIfNeeded();
    const blurControl = page.getByRole('slider', { name: 'Blur radius' });
    await blurControl.waitFor({ state: 'visible', timeout: 5000 });
    await blurControl.fill('14');
    await page.waitForTimeout(500);
    const afterBlur = await canvasPixels(page);
    assert.notEqual(
      Buffer.compare(original, afterBlur),
      0,
      'Blur did not change the rendered source',
    );
    assertions.push('Blur is a real non-destructive adjustment layer');
    await beat(page, 1000);

    await addAdjustment(page, 'Gradient Map');
    const afterGradient = await canvasPixels(page);
    assert.notEqual(
      Buffer.compare(afterBlur, afterGradient),
      0,
      'Gradient Map did not update the render',
    );
    assertions.push('Gradient Map is applied after Blur through the live stack');
    await beat(page, 1000);

    await addAdjustment(page, 'Halftone');
    const afterHalftone = await canvasPixels(page);
    assert.notEqual(
      Buffer.compare(afterGradient, afterHalftone),
      0,
      'Halftone did not update the render',
    );
    assertions.push('Halftone completes the retro treatment without replacing source pixels');
    await beat(page, 1000);

    const labels = await stackLabels(page);
    assert.deepEqual(labels, ['Blur', 'Gradient Map', 'Halftone']);
    assertions.push(`serialized stack is visible in the product panel: ${labels.join(' → ')}`);

    const blurDisable = page.getByRole('button', { name: 'Disable blur' });
    await blurDisable.click();
    await settle(page);
    const blurOff = await canvasPixels(page);
    assert.notEqual(
      Buffer.compare(afterHalftone, blurOff),
      0,
      'disabling Blur did not change output',
    );
    assertions.push('visibility toggle disables one effect directly instead of recreating undo');
    await beat(page, 900);
    await page.getByRole('button', { name: 'Enable blur' }).click();
    await settle(page);

    await page.getByRole('button', { name: 'Move Halftone up' }).click();
    await settle(page);
    const reordered = await stackLabels(page);
    assert.deepEqual(reordered, ['Blur', 'Halftone', 'Gradient Map']);
    assertions.push(`reordering changes the actual stack order: ${reordered.join(' → ')}`);
    await beat(page, 1100);

    const disableButtons = page.locator('.adj-panel__item-vis-btn[aria-label^="Disable"]');
    const count = await disableButtons.count();
    for (let i = 0; i < count; i += 1) await disableButtons.nth(i).click();
    await settle(page);
    const restored = await canvasPixels(page);
    assert.equal(
      Buffer.compare(original, restored),
      0,
      'disabled stack did not restore the source render',
    );
    assertions.push('disabling the full stack restores the original render nondestructively');
    await beat(page, 900);

    const enableButtons = page.locator('.adj-panel__item-vis-btn[aria-label^="Enable"]');
    const enabledCount = await enableButtons.count();
    for (let i = 0; i < enabledCount; i += 1) await enableButtons.nth(i).click();
    await settle(page);
    assert.notEqual(Buffer.compare(original, await canvasPixels(page)), 0);
    assertions.push('the final treatment is restored with all adjustment entries intact');
    await parkPointer(page);
    await beat(page, 1400);
    return assertions;
  },
});
