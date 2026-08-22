#!/usr/bin/env node
/** Video D — Smart Animate correspondence on an expanding weather card. */
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

    // Move the duplicate beside the collapsed state through the inspector's X
    // field. Dragging it by canvas coordinates guessed where the duplicate had
    // landed, and a miss silently left the two states stacked.
    const originX = Number(await page.getByRole('spinbutton', { name: 'X' }).first().inputValue());
    assert.ok(Number.isFinite(originX), 'duplicated state has no readable X position');
    await setNumberField(page, 'X', Math.round(originX) + 420);

    // Enlarge the duplicate's card. The layer tree lists newest-first, so the
    // first rectangle is the duplicate's own card — selecting it by identity
    // rather than by clicking a canvas point that may hit the parent frame.
    // Without a genuinely larger target there is nothing for Smart Animate to
    // interpolate, which is how this clip previously recorded two identical
    // states and still passed.
    const expandedCard = page.getByRole('treeitem').filter({ hasText: /rect/i }).first();
    await expandedCard.click();
    await page.waitForTimeout(400);
    const collapsedWidth = Number(
      await page.getByRole('spinbutton', { name: 'W' }).first().inputValue(),
    );
    await setNumberField(page, 'W', 300);
    await setNumberField(page, 'H', 240);
    await page.waitForTimeout(600);
    assert.ok(
      collapsedWidth > 0 && Math.abs(300 - collapsedWidth) > 40,
      `expanded card (300) is not meaningfully wider than collapsed (${collapsedWidth})`,
    );
    assertions.push(
      `expanded state's card is a genuinely different size (${Math.round(collapsedWidth)}px → 300px wide)`,
    );
    await useTool(page, 'v');

    const screens = (await layerNames(page)).filter((name) => /frame/i.test(name));
    assert.equal(screens.length, 2, 'Smart Animate needs two duplicated frame states');
    // Name the states rather than trusting tree order. The tree lists
    // newest-first, so screens[0] is the duplicate: wiring the interaction
    // from it pointed the flow expanded -> collapsed, and the presenter --
    // which enters on the leftmost frame -- then never showed the source at
    // all. The duplicate is the only one Varve names "copy".
    const expandedState = screens.find((name) => /copy/i.test(name));
    const collapsedState = screens.find((name) => !/copy/i.test(name));
    assert.ok(
      expandedState && collapsedState,
      `could not tell the duplicated state apart: ${JSON.stringify(screens)}`,
    );
    await fitContent(page);
    await parkPointer(page);
    await settle(page);

    begin();
    await beat(page, 900);
    // Match the collapsed state exactly. `new RegExp('Frame 1')` also matches
    // "Frame 1 copy", and selectLayer takes the first hit in a newest-first
    // tree, so the interaction was being attached to the duplicate -- leaving
    // the screen the presenter actually opens with no interaction at all, and
    // the click on it did nothing.
    const exact = (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    await selectLayer(page, exact(collapsedState));
    await page.getByRole('tab', { name: 'Prototype', exact: true }).click();
    await page.getByRole('button', { name: 'Add Interaction' }).click();
    await selectComboboxOption(page, 'Target screen', expandedState);
    await selectComboboxOption(page, 'Transition', 'Smart Animate');
    assertions.push('source and target states use a real Smart Animate transition setting');
    await beat(page, 900);

    await page.keyboard.press('Control+Shift+p');
    const preview = page.getByRole('dialog', { name: 'Prototype Preview' });
    await preview.waitFor({ state: 'visible', timeout: 10000 });
    // The presenter labels screens `Prototype screen: <name>`, so anchor at
    // the end: an unanchored /Frame 1/ also matches "Frame 1 copy".
    const screenLabel = (name) => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const source = preview.getByRole('application', { name: screenLabel(collapsedState) });
    await source.click({ position: { x: 100, y: 220 } });
    await page.waitForTimeout(260);
    assert.ok(
      (await preview.getByRole('application').count()) >= 2,
      'no two-state transition stack rendered',
    );
    // Sample the moving card mid-transition. A screenshot's byte length says
    // nothing — a blank PNG clears any size threshold — so read the card's
    // real geometry while it is between states. PrototypeScreenView paints
    // each node as a positioned hotspot button fed by `hotspotOverrides`,
    // which is exactly where computeSmartAnimateHotspotOverrides writes the
    // interpolated geometry for the current transitionProgress; the screens
    // themselves are an <img>, so there is no canvas or svg to measure. The
    // widest hotspot is the weather card.
    const cardWidth = async () => {
      const hotspots = await preview.locator('.prototype-screen-view__hotspot').all();
      let widest = 0;
      for (const hotspot of hotspots) {
        const box = await hotspot.boundingBox();
        if (box) widest = Math.max(widest, box.width);
      }
      return widest;
    };
    const midWidth = await cardWidth();
    await page.waitForTimeout(700);
    assert.ok(
      await preview.getByRole('application', { name: screenLabel(expandedState) }).isVisible(),
    );
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
