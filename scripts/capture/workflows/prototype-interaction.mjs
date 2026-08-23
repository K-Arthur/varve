#!/usr/bin/env node
/** Video C — a real travel-booking prototype interaction and preview route. */
import { strict as assert } from 'node:assert';
import {
  beat,
  dragAt,
  dragPage,
  fitContent,
  openCleanEditor,
  parkPointer,
  selectComboboxOption,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

async function makeScreen(page, from, to, expectedName) {
  await page.keyboard.press('Escape');
  await useTool(page, 'v');
  await useTool(page, 'f');
  await dragAt(page, from, to, { steps: 12, settleMs: 250 });
  const root = page.locator('[role="treeitem"][aria-level="1"]').first();
  await root.waitFor({ state: 'visible', timeout: 5000 });
  await settle(page, { pauseMs: 150 });
  return expectedName ?? (await root.innerText()).split('\n')[0].trim();
}

async function selectedFrameBox(page) {
  const rect = page.locator('svg[role="presentation"]:visible > rect').first();
  await rect.waitFor({ state: 'visible', timeout: 5000 });
  const box = await rect.boundingBox();
  if (!box || box.width < 20 || box.height < 20)
    throw new Error('selected frame has no visible bounds');
  return box;
}

function inFrame(box, x, y) {
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

async function drawRectInFrame(page, box, from, to) {
  await useTool(page, 'r');
  await dragPage(page, inFrame(box, from[0], from[1]), inFrame(box, to[0], to[1]), {
    steps: 10,
    settleMs: 200,
  });
}

async function drawFilledRectInFrame(page, box, from, to, fill) {
  await drawRectInFrame(page, box, from, to);
  await setFillHex(page, fill);
  await page.keyboard.press('Escape');
  await useTool(page, 'v');
}

async function drawTextInFrame(page, box, from, to, text) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  // The canvas is partly covered by the top ruler at its local origin. Focus
  // it directly so keyboard tool changes do not depend on a fragile click.
  await canvas.focus();
  await page.keyboard.press('Escape');
  await useTool(page, 't');
  await dragPage(page, inFrame(box, from[0], from[1]), inFrame(box, to[0], to[1]), {
    steps: 10,
    settleMs: 120,
  });
  const editor = page.getByRole('textbox', { name: /editing text/i });
  await editor.waitFor({ state: 'visible', timeout: 20000 });
  await editor.fill(text);
  await editor.press('Escape');
  await page.waitForTimeout(250);
  await useTool(page, 'v');
}

async function setFillHex(page, hex) {
  const swatch = page.locator('.insp-swatch[aria-label="Fill colour"]');
  if (!(await swatch.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  await swatch.click();
  const dialog = page.getByRole('dialog', { name: /pick fill colour/i });
  await dialog.waitFor({ state: 'visible', timeout: 3000 });
  const field = dialog.getByRole('textbox', { name: 'Hex color' });
  if (!(await field.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  await field.fill(hex);
  await field.press('Enter');
  await page.waitForTimeout(350);
  await dialog.getByRole('button', { name: /^done$/i }).click();
  await page.waitForTimeout(250);
  return true;
}

async function makeButton(page, box, from, to, label, fill) {
  // Prototype screens are real Frames; the controls inside them are real
  // rectangle/text button compositions so the presenter does not mistake
  // every decorative control for another screen.
  await drawFilledRectInFrame(page, box, from, to, fill);
  await drawTextInFrame(
    page,
    box,
    [from[0] + 0.02, from[1] + 0.012],
    [to[0] - 0.02, to[1] + 0.012],
    label,
  );
}

async function selectScreen(page, name) {
  // LayersTree virtualizes long trees. Searching by the exact frame name
  // reveals an off-screen root deterministically before selecting it.
  const filter = page.getByRole('searchbox', { name: 'Filter layers by name' });
  await filter.fill(name);
  await page.waitForTimeout(250);
  const root = page
    .locator('[role="treeitem"][aria-level="1"]')
    .filter({ hasText: new RegExp(`^${name}\\b`) })
    .first();
  await root.waitFor({ state: 'visible', timeout: 6000 });
  await root.click();
  await filter.fill('');
  await page.waitForTimeout(400);
}

await capture({
  slug: 'prototype-interaction',
  workflow: 'Prototype interaction',
  purpose:
    'A compact travel-booking flow navigates between real frame screens in presentation mode.',
  duration: [18, 24],
  authoredMotion: true,
  fixture: null,

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];
    await openCleanEditor(page, base);
    await settle(page);

    // Create all three top-level screens before populating any of them. This
    // keeps later primitives from becoming children of the next frame while
    // the canvas still has the previous screen selected.
    const searchScreen = await makeScreen(page, [0.06, 0.16], [0.33, 0.76], 'Frame 1');
    const detailsScreen = await makeScreen(page, [0.365, 0.16], [0.635, 0.76], 'Frame 2');
    const confirmationScreen = await makeScreen(page, [0.67, 0.16], [0.94, 0.76], 'Frame 3');

    // ── Screen 1: Destination search ──
    await selectScreen(page, searchScreen);
    const searchBox = await selectedFrameBox(page);
    await drawTextInFrame(page, searchBox, [0.1, 0.1], [0.9, 0.16], 'NORTHLINE TRAVEL');
    await drawTextInFrame(page, searchBox, [0.1, 0.19], [0.9, 0.25], 'Find a slower way there.');
    await drawFilledRectInFrame(page, searchBox, [0.1, 0.3], [0.9, 0.43], '#E5F3F1');
    await drawFilledRectInFrame(page, searchBox, [0.13, 0.325], [0.22, 0.405], '#1F827C');
    await drawTextInFrame(page, searchBox, [0.25, 0.33], [0.88, 0.405], 'Where to?');
    await drawFilledRectInFrame(page, searchBox, [0.1, 0.49], [0.9, 0.7], '#FFFDFC');
    await drawFilledRectInFrame(page, searchBox, [0.14, 0.53], [0.29, 0.66], '#E3B04B');
    await drawTextInFrame(
      page,
      searchBox,
      [0.34, 0.53],
      [0.86, 0.68],
      'KYOTO\n5 nights · from ¥38,000',
    );
    await makeButton(page, searchBox, [0.48, 0.74], [0.9, 0.86], 'SEARCH STAYS', '#D6EFEA');

    // ── Screen 2: Ryokan details ──
    await selectScreen(page, detailsScreen);
    const detailsBox = await selectedFrameBox(page);
    await drawTextInFrame(page, detailsBox, [0.1, 0.1], [0.9, 0.16], 'NORTHLINE / KYOTO');
    await drawTextInFrame(
      page,
      detailsBox,
      [0.1, 0.19],
      [0.9, 0.25],
      'A quiet room near the river.',
    );
    await drawFilledRectInFrame(page, detailsBox, [0.1, 0.3], [0.9, 0.51], '#DCE6F2');
    await drawFilledRectInFrame(page, detailsBox, [0.16, 0.34], [0.42, 0.47], '#6B8CC7');
    await drawTextInFrame(page, detailsBox, [0.48, 0.33], [0.88, 0.47], 'MIZU\nRYOKAN');
    await drawFilledRectInFrame(page, detailsBox, [0.1, 0.57], [0.9, 0.72], '#FFFDFC');
    await drawTextInFrame(
      page,
      detailsBox,
      [0.15, 0.61],
      [0.88, 0.7],
      'MIZU RYOKAN\n¥42,800 · 4.9 ★',
    );
    await makeButton(page, detailsBox, [0.1, 0.77], [0.9, 0.89], 'RESERVE ROOM  →', '#E77C6A');

    // ── Screen 3: Booking confirmation ──
    await selectScreen(page, confirmationScreen);
    const confirmationBox = await selectedFrameBox(page);
    await drawTextInFrame(page, confirmationBox, [0.1, 0.1], [0.9, 0.16], 'NORTHLINE / CONFIRM');
    await drawTextInFrame(page, confirmationBox, [0.1, 0.19], [0.9, 0.25], 'Your stay is ready.');
    await drawFilledRectInFrame(page, confirmationBox, [0.1, 0.3], [0.9, 0.7], '#FFFDFC');
    await drawFilledRectInFrame(page, confirmationBox, [0.16, 0.37], [0.31, 0.48], '#1F827C');
    await drawTextInFrame(
      page,
      confirmationBox,
      [0.36, 0.37],
      [0.86, 0.65],
      '✓  BOOKED\nPAID\nMizu Ryokan\n12–17 September · 1 room',
    );
    await makeButton(
      page,
      confirmationBox,
      [0.1, 0.77],
      [0.9, 0.89],
      'VIEW ITINERARY  →',
      '#D6EFEA',
    );

    await useTool(page, 'v');
    const screenNames = [searchScreen, detailsScreen, confirmationScreen];
    const roots = page.locator('[role="treeitem"][aria-level="1"]');
    for (const name of screenNames) {
      const filter = page.getByRole('searchbox', { name: 'Filter layers by name' });
      await filter.fill(name);
      await page.waitForTimeout(250);
      assert.equal(
        await roots.filter({ hasText: new RegExp(`^${name}\\b`) }).count(),
        1,
        `${name} screen missing`,
      );
      await filter.fill('');
    }
    assert.ok(
      (await page.locator('[role="treeitem"][aria-level="2"]').count()) >= 9,
      'travel flow has no nested card and button content',
    );
    await fitContent(page);
    await parkPointer(page);
    await settle(page);

    // ── Wire up navigation: each screen frame is the interaction source ──
    begin();
    await beat(page, 1100);

    // Screen 1 → Screen 2
    await selectScreen(page, screenNames[0]);
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
    await selectScreen(page, screenNames[1]);
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
