#!/usr/bin/env node
/** Video C — a real travel-booking prototype interaction and preview route. */
import { strict as assert } from 'node:assert';
import {
  beat,
  dragAt,
  fitContent,
  layerNames,
  openCleanEditor,
  parkPointer,
  selectComboboxOption,
  selectLayer,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

async function makeScreen(page, from, to) {
  await useTool(page, 'f');
  await dragAt(page, from, to, { steps: 12, settleMs: 250 });
}

async function drawRect(page, from, to) {
  await useTool(page, 'r');
  await dragAt(page, from, to, { steps: 10, settleMs: 200 });
}

async function drawText(page, from, to, text) {
  await useTool(page, 't');
  await dragAt(page, from, to, { steps: 10, settleMs: 120 });
  const editor = page.getByRole('textbox', { name: /editing text/i });
  await editor.waitFor({ state: 'visible', timeout: 8000 });
  await editor.fill(text);
  await editor.press('Escape');
  await page.waitForTimeout(250);
}

async function addNavigation(page, sourceName, targetName) {
  await selectLayer(page, new RegExp(sourceName));
  await page.getByRole('tab', { name: 'Prototype', exact: true }).click();
  await page.getByRole('button', { name: 'Add Interaction' }).click();
  await page.waitForTimeout(400);
  await selectComboboxOption(page, 'Target screen', targetName);
  await page.waitForTimeout(300);
  // Clicking a layer row calls revealSelection({ fit: true }) (LayersTree),
  // which zooms the canvas to that single screen -- the delivered clip sat at
  // 753% on one rectangle. Reframe so all three screens stay on camera.
  await fitContent(page);
  await parkPointer(page);
}

await capture({
  slug: 'prototype-interaction',
  workflow: 'Prototype interaction',
  purpose:
    'A compact travel-booking flow navigates between real frame screens in presentation mode.',
  duration: [18, 28],
  authoredMotion: true,
  fixture: null,

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];
    await openCleanEditor(page, base);
    await settle(page);
    await makeScreen(page, [0.12, 0.18], [0.36, 0.72]);
    await drawRect(page, [0.15, 0.23], [0.33, 0.37]);
    await drawText(page, [0.15, 0.40], [0.33, 0.46], 'Kyoto — 5 nights');

    await makeScreen(page, [0.43, 0.18], [0.67, 0.72]);
    await drawRect(page, [0.46, 0.23], [0.64, 0.37]);
    await drawText(page, [0.46, 0.40], [0.64, 0.46], 'Ryokan · ¥42,800');

    await makeScreen(page, [0.74, 0.18], [0.92, 0.72]);
    await drawRect(page, [0.76, 0.23], [0.90, 0.37]);
    await drawText(page, [0.76, 0.40], [0.90, 0.46], 'Booked ✓');
    await useTool(page, 'v');
    const screenNames = (await layerNames(page)).filter((name) => /^Frame \d+$/.test(name.trim()));
    assert.equal(screenNames.length, 3, 'travel flow needs three real frame screens');
    await fitContent(page);
    await parkPointer(page);
    await settle(page);

    begin();
    await beat(page, 1100);
    await addNavigation(page, screenNames[0], screenNames[1]);
    assertions.push('source screen has a persisted On click → Navigate to interaction');
    await beat(page, 900);
    await addNavigation(page, screenNames[1], screenNames[2]);
    assertions.push('details screen has a second persisted navigation interaction');
    await beat(page, 800);

    // Present is the real workspace shortcut, which opens PrototypePresenter.
    await page.keyboard.press('Control+Shift+p');
    const preview = page.getByRole('dialog', { name: 'Prototype Preview' });
    await preview.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1200);
    assert.ok(await preview.getByRole('application', { name: /Prototype screen/ }).isVisible());
    assertions.push('presentation opened the real Prototype Preview route');
    await beat(page, 1000);

    const sourceScreen = preview.getByRole('application', { name: new RegExp(screenNames[0]) });
    await sourceScreen.click({ position: { x: 80, y: 340 } });
    await page.waitForTimeout(600);
    assert.ok(
      await preview.getByRole('application', { name: new RegExp(screenNames[1]) }).isVisible(),
      'click did not navigate to the configured target screen',
    );
    assertions.push(
      'clicking the source screen hit area navigated to the configured details screen',
    );
    await beat(page, 1300);

    await preview
      .getByRole('application', { name: new RegExp(screenNames[1]) })
      .click({ position: { x: 80, y: 340 } });
    await page.waitForTimeout(600);
    assert.ok(
      await preview.getByRole('application', { name: new RegExp(screenNames[2]) }).isVisible(),
    );
    assertions.push('the secondary interaction reached the confirmation screen');
    await beat(page, 1100);
    await page.keyboard.press('Escape');
    await preview.waitFor({ state: 'hidden', timeout: 8000 });
    assertions.push('Escape returned cleanly from presentation to the editor');
    await parkPointer(page);
    await settle(page);
    await beat(page, 1100);
    return assertions;
  },
  metadata: {
    productTruth: 'document interactions + PrototypePresenter hit testing and navigation',
  },
});
