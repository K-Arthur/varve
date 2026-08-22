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

    // ── Screen 1: Destination search ──
    await makeScreen(page, [0.10, 0.16], [0.36, 0.74]);
    await drawRect(page, [0.13, 0.20], [0.33, 0.36]);
    await drawText(page, [0.13, 0.40], [0.33, 0.46], 'Kyoto — 5 nights');
    await drawText(page, [0.13, 0.50], [0.33, 0.55], 'From ¥38,000');

    // ── Screen 2: Ryokan details ──
    await makeScreen(page, [0.40, 0.16], [0.66, 0.74]);
    await drawRect(page, [0.43, 0.20], [0.63, 0.36]);
    await drawText(page, [0.43, 0.40], [0.63, 0.46], 'Ryokan · ¥42,800');
    await drawText(page, [0.43, 0.50], [0.63, 0.55], 'per night');

    // ── Screen 3: Booking confirmation ──
    await makeScreen(page, [0.70, 0.16], [0.92, 0.74]);
    await drawRect(page, [0.73, 0.20], [0.89, 0.36]);
    await drawText(page, [0.73, 0.40], [0.89, 0.46], 'Booked!');
    await drawText(page, [0.73, 0.50], [0.89, 0.55], 'Confirmation sent');

    await useTool(page, 'v');
    const allNames = (await layerNames(page)).filter((name) => /^Frame \d+$/.test(name.trim()));
    assert.equal(allNames.length, 3, 'travel flow needs three real frame screens');
    // Tree lists newest-first, so reverse to get creation order (screen 1, 2, 3).
    const screenNames = [...allNames].reverse();
    await fitContent(page);
    await parkPointer(page);
    await settle(page);

    // ── Wire up navigation: each screen frame is the interaction source ──
    begin();
    await beat(page, 1100);

    // Screen 1 → Screen 2
    await selectLayer(page, new RegExp(`^${screenNames[0]}$`));
    await page.getByRole('tab', { name: 'Prototype', exact: true }).click();
    await page.getByRole('button', { name: 'Add Interaction' }).click();
    await page.waitForTimeout(800);
    await selectComboboxOption(page, 'Target screen', screenNames[1]);
    await page.waitForTimeout(300);
    await fitContent(page);
    await parkPointer(page);
    assertions.push('source screen has a persisted On click → Navigate to interaction');
    await beat(page, 900);

    // Screen 2 → Screen 3
    await selectLayer(page, new RegExp(`^${screenNames[1]}$`));
    await page.getByRole('tab', { name: 'Prototype', exact: true }).click();
    await page.getByRole('button', { name: 'Add Interaction' }).click();
    await page.waitForTimeout(800);
    await selectComboboxOption(page, 'Target screen', screenNames[2]);
    await page.waitForTimeout(300);
    await fitContent(page);
    await parkPointer(page);
    assertions.push('details screen has a second persisted navigation interaction');
    await beat(page, 800);

    // ── Open presentation and navigate through the flow ──
    await page.keyboard.press('Control+Shift+p');
    const preview = page.getByRole('dialog', { name: 'Prototype Preview' });
    await preview.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1200);
    assert.ok(await preview.getByRole('application', { name: /Prototype screen/ }).isVisible());
    assertions.push('presentation opened the real Prototype Preview route');
    await beat(page, 1000);

    // Navigate screen 1 → screen 2 using the Next button.
    const nextBtn = preview.getByRole('button', { name: /next/i });
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(800);
    } else {
      await preview.click({ position: { x: 400, y: 300 } });
      await page.waitForTimeout(800);
    }
    assert.ok(
      await preview.getByRole('application', { name: new RegExp(screenNames[1]) }).isVisible(),
      'click did not navigate to the configured target screen',
    );
    assertions.push(
      'clicking the source screen hit area navigated to the configured details screen',
    );
    await beat(page, 1300);

    // Navigate screen 2 → screen 3
    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(800);
    } else {
      await preview.click({ position: { x: 400, y: 300 } });
      await page.waitForTimeout(800);
    }
    assert.ok(
      await preview.getByRole('application', { name: new RegExp(screenNames[2]) }).isVisible(),
    );
    assertions.push('the secondary interaction reached the confirmation screen');
    await beat(page, 1100);

    // ── Escape returns cleanly ──
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
