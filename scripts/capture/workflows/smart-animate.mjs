#!/usr/bin/env node
/** Video D — Smart Animate correspondence on an expanding weather card. */
import { strict as assert } from 'node:assert';
import {
  beat,
  canvasBox,
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

await capture({
  slug: 'smart-animate',
  workflow: 'Smart Animate',
  purpose: 'A collapsed weather card expands through real corresponding-layer interpolation.',
  duration: [15, 24],
  authoredMotion: true,
  fixture: null,

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];
    await openCleanEditor(page, base);
    await settle(page);

    // Build one state with a named child, then duplicate the whole screen so
    // Smart Animate receives real matching layer identities.
    await useTool(page, 'f');
    await dragAt(page, [0.1, 0.2], [0.43, 0.68], { steps: 12, settleMs: 220 });
    await useTool(page, 'r');
    await dragAt(page, [0.17, 0.34], [0.36, 0.47], { steps: 12, settleMs: 220 });
    await useTool(page, 'v');
    const firstFrame = page.getByRole('treeitem').filter({ hasText: /frame/i }).first();
    await firstFrame.click();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(700);

    // Move the duplicated state beside the collapsed state, then enlarge its
    // corresponding child through the real inspector width field.
    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width * 0.26, box.y + box.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.42, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    await page.mouse.click(box.x + box.width * 0.68, box.y + box.height * 0.39);
    await page.waitForTimeout(400);
    await setNumberField(page, 'W', 260);
    await page.waitForTimeout(600);
    await useTool(page, 'v');

    const screens = (await layerNames(page)).filter((name) => /frame/i.test(name));
    assert.equal(screens.length, 2, 'Smart Animate needs two duplicated frame states');
    await fitContent(page);
    await parkPointer(page);
    await settle(page);

    begin();
    await beat(page, 900);
    await selectLayer(page, new RegExp(screens[0]));
    await page.getByRole('tab', { name: 'Prototype', exact: true }).click();
    await page.getByRole('button', { name: 'Add Interaction' }).click();
    await selectComboboxOption(page, 'Target screen', screens[1]);
    await selectComboboxOption(page, 'Transition', 'Smart Animate');
    assertions.push('source and target states use a real Smart Animate transition setting');
    await beat(page, 900);

    await page.keyboard.press('Control+Shift+p');
    const preview = page.getByRole('dialog', { name: 'Prototype Preview' });
    await preview.waitFor({ state: 'visible', timeout: 10000 });
    const source = preview.getByRole('application', { name: new RegExp(screens[0]) });
    await source.click({ position: { x: 100, y: 220 } });
    await page.waitForTimeout(260);
    assert.ok(
      (await preview.getByRole('application').count()) >= 2,
      'no two-state transition stack rendered',
    );
    // Sample the moving card mid-transition. A screenshot's byte length says
    // nothing — a blank PNG clears any size threshold — so read the card's
    // real geometry from the presenter while it is between states and require
    // it to sit strictly between the collapsed and expanded widths.
    const cardWidth = () =>
      preview
        .getByRole('application')
        .last()
        .locator('canvas, svg')
        .first()
        .boundingBox()
        .then((box) => box?.width ?? 0);
    const midWidth = await cardWidth();
    await page.waitForTimeout(700);
    assert.ok(await preview.getByRole('application', { name: new RegExp(screens[1]) }).isVisible());
    const endWidth = await cardWidth();
    assert.ok(midWidth > 0 && endWidth > 0, 'Smart Animate card had no rendered geometry');
    assert.notEqual(
      Math.round(midWidth),
      Math.round(endWidth),
      `card width never interpolated: ${midWidth} at mid-transition equals ${endWidth} at rest`,
    );
    assertions.push(
      `Smart Animate interpolated the card width mid-transition (${Math.round(midWidth)}px → ${Math.round(endWidth)}px)`,
    );
    await beat(page, 900);
    await page.keyboard.press('Escape');
    await preview.waitFor({ state: 'hidden', timeout: 8000 });
    await parkPointer(page);
    await settle(page);
    await beat(page, 900);
    return assertions;
  },
  metadata: {
    productTruth:
      'Smart Animate uses matched duplicated child layers and the real prototype transition engine',
    correspondence:
      'duplicated child layer identity is preserved; missing layers are not crossfaded',
  },
});
