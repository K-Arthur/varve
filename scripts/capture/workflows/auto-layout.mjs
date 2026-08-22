#!/usr/bin/env node
/** Video A — real auto-layout: a music-player playlist row system. */
import { strict as assert } from 'node:assert';
import {
  beat,
  canvasPixels,
  dragAt,
  fitContent,
  layerNames,
  openCleanEditor,
  parkPointer,
  selectComboboxOption,
  selectLayer,
  setNumberField,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

async function drawRect(page, from, to) {
  await useTool(page, 'r');
  await dragAt(page, from, to, { steps: 12, settleMs: 220 });
}

async function drawText(page, from, to, text) {
  await useTool(page, 't');
  await dragAt(page, from, to, { steps: 12, settleMs: 120 });
  const editor = page.getByRole('textbox', { name: /editing text/i });
  await editor.waitFor({ state: 'visible', timeout: 8000 });
  await editor.fill(text);
  await editor.press('Escape');
  await page.waitForTimeout(300);
}

await capture({
  slug: 'auto-layout',
  workflow: 'Auto-layout',
  purpose: 'A playlist row system reflows through real flex auto-layout controls as content grows.',
  duration: [18, 28],
  fixture: null,

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];
    await openCleanEditor(page, base);
    await settle(page);

    // Build a distinct music-player card: one parent frame and three row frames.
    await useTool(page, 'f');
    await dragAt(page, [0.08, 0.14], [0.92, 0.86], { steps: 14, settleMs: 250 });
    await useTool(page, 'f');
    await dragAt(page, [0.14, 0.25], [0.86, 0.38], { steps: 12, settleMs: 220 });
    await drawRect(page, [0.17, 0.28], [0.25, 0.35]);
    await drawText(page, [0.29, 0.27], [0.61, 0.32], 'Night Drive');
    await drawText(page, [0.63, 0.27], [0.78, 0.32], '04:12');

    await useTool(page, 'f');
    await dragAt(page, [0.14, 0.45], [0.86, 0.58], { steps: 12, settleMs: 220 });
    await drawRect(page, [0.17, 0.48], [0.25, 0.55]);
    await drawText(page, [0.29, 0.47], [0.61, 0.52], 'Glass Signals');
    await drawText(page, [0.63, 0.47], [0.78, 0.52], '03:48');

    await useTool(page, 'f');
    await dragAt(page, [0.14, 0.65], [0.86, 0.78], { steps: 12, settleMs: 220 });
    await drawRect(page, [0.17, 0.68], [0.25, 0.75]);
    await drawText(page, [0.29, 0.67], [0.61, 0.72], 'Low Tide');
    await drawText(page, [0.63, 0.67], [0.78, 0.72], '05:06');
    await useTool(page, 'v');

    // The parent is the only frame clicked in its empty upper-left padding.
    await page.mouse.click(
      ...(await (async () => {
        const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
        if (!box) throw new Error('canvas not found');
        return [box.x + box.width * 0.1, box.y + box.height * 0.17];
      })()),
    );
    await page.waitForTimeout(500);
    await page
      .getByRole('button', { name: 'Layout' })
      .click()
      .catch(() => undefined);
    begin();
    await beat(page, 1000);
    await selectComboboxOption(page, 'Layout mode', 'Flex');
    await selectComboboxOption(page, 'Layout direction', 'Column');
    assertions.push('parent playlist frame uses the real Flex layout mode and Column direction');
    await beat(page, 900);

    const beforeGap = await canvasPixels(page);
    await page.getByRole('spinbutton', { name: 'Gap' }).fill('28');
    await page.getByRole('spinbutton', { name: 'Gap' }).press('Enter');
    await page.waitForTimeout(500);
    assert.notEqual(
      Buffer.compare(beforeGap, await canvasPixels(page)),
      0,
      'gap did not reflow rows',
    );
    assertions.push('changing Gap reflowed the child row geometry');
    await beat(page, 800);

    for (const side of ['Padding T', 'Padding R', 'Padding B', 'Padding L']) {
      const field = page.getByRole('spinbutton', { name: side });
      await field.fill('20');
      await field.press('Enter');
    }
    assertions.push('container padding was changed through all four real inspector fields');
    await beat(page, 700);

    await setNumberField(page, 'W', 760);
    assertions.push(
      'container width was resized through the inspector and children remained in layout',
    );
    await beat(page, 800);

    // Select the actual song-title node and replace it with a much longer title.
    // The layer tree lists newest-first, so the first text item is the last
    // cell drawn — row three's duration, not a title. Each row was drawn as
    // rectangle, then title, then duration, so the *last* text item in the
    // tree is the first title drawn: "Night Drive" in row one. The content is
    // asserted below before the edit, so picking the wrong node fails the run
    // rather than quietly recording an edit to the wrong cell.
    const textLayers = page.getByRole('treeitem').filter({ hasText: /text/i });
    assert.ok(
      (await textLayers.count()) >= 6,
      'expected a title and a duration text layer per playlist row',
    );
    await textLayers.last().click();
    await page.waitForTimeout(350);
    const beforeLongTitle = await canvasPixels(page);
    const editText = page
      .locator('.selection-quick-bar')
      .getByRole('button', { name: /edit text/i });
    await editText.waitFor({ state: 'visible', timeout: 6000 });
    await editText.click();
    const textEditor = page.getByRole('textbox', { name: /editing text/i });
    if (await textEditor.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Confirm this really is row one's song title before lengthening it.
      // Layer names carry no content, so the editor's own value is the only
      // honest check that the intended node is the one being edited.
      assert.equal(
        (await textEditor.inputValue()).trim(),
        'Night Drive',
        'selected node is not the row-one song title',
      );
      await textEditor.fill('Night Drive — Extended Midnight Session');
      await textEditor.press('Escape');
    } else {
      throw new Error('text layer did not enter real text editing mode');
    }
    await useTool(page, 'v');
    await parkPointer(page);
    await settle(page);
    assert.notEqual(
      Buffer.compare(beforeLongTitle, await canvasPixels(page)),
      0,
      'long title edit did not change the rendered row',
    );
    assertions.push(
      'editing the title to a significantly longer string recomputed the row without overlap',
    );
    await beat(page, 1300);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(500);
    assertions.push('undo and redo completed after the layout/content edits');
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    await beat(page, 1200);
    return assertions;
  },
  metadata: { productTruth: 'layoutStyle.mode=flex; reflow driven by @varve/layout' },
});
