#!/usr/bin/env node
/** Video D — Smart Animate correspondence on an expanding weather card. */
import { strict as assert } from 'node:assert';
import {
  useTool as activateTool,
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
    await activateTool(page, 'f');
    await dragAt(page, [0.1, 0.2], [0.43, 0.68], { steps: 12, settleMs: 220 });
    await activateTool(page, 'r');
    await dragAt(page, [0.17, 0.34], [0.36, 0.47], { steps: 12, settleMs: 220 });
    await activateTool(page, 'v');
    // Remember what the card is called before duplication renames the copy.
    const collapsedCardName = (
      await page.getByRole('treeitem').filter({ hasText: /rect/i }).first().innerText()
    ).trim();
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
    await setNumberField(page, 'W', 210);
    await setNumberField(page, 'H', 210);
    await page.waitForTimeout(600);
    assert.ok(
      collapsedWidth > 0 && Math.abs(210 - collapsedWidth) > 40,
      `expanded card (210) is not meaningfully wider than collapsed (${collapsedWidth})`,
    );
    assertions.push(
      `expanded state's card is a genuinely different size (${Math.round(collapsedWidth)}px → 210px wide)`,
    );

    // Smart Animate matches corresponding layers *by name*
    // (matchLayersByName), but duplicating a frame renames every descendant,
    // so the card is "Rectangle 1" in one state and "Rectangle 1 copy" in the
    // other. With no match, computeSmartAnimateTransition returns null and the
    // card snaps between states instead of interpolating. Rename the copy's
    // card back through the real F2 rename so the two states correspond.
    await expandedCard.click();
    await page.waitForTimeout(250);
    await page.keyboard.press('F2');
    const renameInput = page.locator('.layers-row__name-input');
    await renameInput.waitFor({ state: 'visible', timeout: 5000 });
    const duplicatedName = await renameInput.inputValue();
    await renameInput.fill(collapsedCardName);
    await renameInput.press('Enter');
    await page.waitForTimeout(400);
    assertions.push(
      `renamed the duplicate's card ${JSON.stringify(duplicatedName)} back to ${JSON.stringify(collapsedCardName)} so Smart Animate can correspond the layers`,
    );
    await activateTool(page, 'v');

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
    await beat(page, 1600);
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
    // The interaction ships at 300ms, which is under this harness's sampling
    // latency and too quick to read on camera. Stretch it through the real
    // Duration control rather than slowing the engine for the capture.
    const durationField = page.getByLabel('Duration (ms)').first();
    await durationField.fill('1400');
    await durationField.press('Enter');
    // Leave the field before the Present shortcut: a text input swallows
    // Control+Shift+P, and the presenter then never opens.
    await durationField.blur();
    await page.waitForTimeout(300);
    assertions.push('source and target states use a real Smart Animate transition set to 1400ms');
    await beat(page, 1800);

    await page.keyboard.press('Control+Shift+p');
    const preview = page.getByRole('dialog', { name: 'Prototype Preview' });
    await preview.waitFor({ state: 'visible', timeout: 10000 });
    // The presenter labels screens `Prototype screen: <name>`, so anchor at
    // the end: an unanchored /Frame 1/ also matches "Frame 1 copy".
    const screenLabel = (name) => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const source = preview.getByRole('application', { name: screenLabel(collapsedState) });

    // Record the card across the whole transition rather than peeking once.
    // A single delayed sample raced the 300ms default and read only the
    // settled state, so the clip could show no interpolation and still pass.
    // The sampler runs in the page on requestAnimationFrame, so it observes
    // the same frames the engine paints.
    const samples = page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const widths = [];
          const started = performance.now();
          const tick = () => {
            let widest = 0;
            for (const el of document.querySelectorAll('.prototype-screen-view__hotspot')) {
              widest = Math.max(widest, el.getBoundingClientRect().width);
            }
            widths.push(Math.round(widest));
            if (performance.now() - started < ms) requestAnimationFrame(tick);
            else resolve(widths);
          };
          requestAnimationFrame(tick);
        }),
      2200,
    );
    await source.click({ position: { x: 60, y: 300 } });
    const widths = await samples;

    const seen = [...new Set(widths.filter((w) => w > 0))].sort((a, b) => a - b);
    assert.ok(seen.length > 0, 'Smart Animate card had no rendered geometry at any frame');
    const smallest = seen[0];
    const largest = seen[seen.length - 1];
    const between = seen.filter((w) => w > smallest + 2 && w < largest - 2);
    assert.ok(
      largest - smallest > 30,
      `card never changed size during the transition (widths seen: ${seen.join(', ')})`,
    );
    assert.ok(
      between.length >= 3,
      `card jumped between states instead of interpolating (widths seen: ${seen.join(', ')})`,
    );
    assert.ok(
      await preview.getByRole('application', { name: screenLabel(expandedState) }).isVisible(),
    );
    assertions.push(
      `Smart Animate interpolated the card through ${between.length} intermediate widths (${smallest}px → ${largest}px)`,
    );
    await beat(page, 2600);

    // Replay once. A 1.4s morph in the middle of the clip is easy to miss,
    // and stepping back through the presenter's own Previous control is the
    // real way a reviewer would watch it again.
    await preview.getByRole('button', { name: 'Previous screen' }).click();
    await page.waitForTimeout(900);
    assert.ok(
      await preview.getByRole('application', { name: screenLabel(collapsedState) }).isVisible(),
      'Previous screen did not return to the collapsed state',
    );
    await beat(page, 900);
    await source.click({ position: { x: 60, y: 300 } });
    await page.waitForTimeout(1800);
    assert.ok(
      await preview.getByRole('application', { name: screenLabel(expandedState) }).isVisible(),
      'replayed transition did not reach the expanded state',
    );
    assertions.push('the transition replays from the presenter without re-authoring it');
    await beat(page, 2400);
    await page.keyboard.press('Escape');
    await preview.waitFor({ state: 'hidden', timeout: 8000 });
    await parkPointer(page);
    await settle(page);
    await beat(page, 2000);
    return assertions;
  },
  metadata: {
    productTruth:
      'Smart Animate uses matched child layers and the real prototype transition engine',
    correspondence:
      "matchLayersByName pairs layers by name; the clip renames the duplicate's card so the two states correspond",
    limitation:
      'Duplicating a frame suffixes every descendant with " copy" (context.tsx cloneNodeDeep, asserted in editor.test.tsx), so a frame and its duplicate share no layer names and Smart Animate snaps between them until a layer is renamed.',
  },
});
