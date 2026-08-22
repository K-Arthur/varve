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

async function addNavigation(page, sourceName, targetName) {
  await selectLayer(page, new RegExp(sourceName));
  await page.getByRole('tab', { name: 'Prototype', exact: true }).click();
  await page.getByRole('button', { name: 'Add Interaction' }).click();
  await page.waitForTimeout(400);
  await selectComboboxOption(page, 'Target screen', targetName);
  await page.waitForTimeout(300);
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
    await makeScreen(page, [0.43, 0.18], [0.67, 0.72]);
    await makeScreen(page, [0.74, 0.18], [0.92, 0.72]);
    await useTool(page, 'v');
    const screenNames = (await layerNames(page)).filter((name) => /frame/i.test(name));
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
    await sourceScreen.click({ position: { x: 80, y: 180 } });
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
      .click({ position: { x: 80, y: 180 } });
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
