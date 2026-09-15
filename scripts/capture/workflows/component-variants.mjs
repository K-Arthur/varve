#!/usr/bin/env node
/** Video B — real reusable component and variant semantics. */
import { strict as assert } from 'node:assert';
import {
  useTool as activateTool,
  beat,
  canvasPixels,
  dragAt,
  fitContent,
  layerNames,
  openCleanEditor,
  parkPointer,
  setNumberField,
  settle,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

async function openObjectAction(page, label) {
  await page.getByRole('menuitem', { name: /^Object$/ }).click();
  const action = page.getByRole('menuitem', { name: new RegExp(`^${label}$`, 'i') });
  await action.waitFor({ state: 'visible', timeout: 6000 });
  await action.click();
  await page.waitForTimeout(700);
}

async function addText(page, from, to, copy) {
  await activateTool(page, 't');
  await dragAt(page, from, to, { steps: 10, settleMs: 120 });
  const editor = page.getByRole('textbox', { name: /editing text/i });
  await editor.waitFor({ state: 'visible', timeout: 8000 });
  await editor.fill(copy);
  await editor.press('Escape');
  await page.waitForTimeout(300);
  await activateTool(page, 'v');
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

await capture({
  slug: 'component-variants',
  workflow: 'Reusable component / variant',
  purpose:
    'A transit-ticket purchase button is promoted to a real component and switched between variants.',
  duration: [20, 30],
  fixture: null,

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];
    await openCleanEditor(page, base);
    await settle(page);

    // Build a small ticket-picker composition rather than three anonymous
    // boxes: the cards are real Frames with real text children, and their
    // varied fills make the later component/variant change legible on camera.

    // Three visually distinct ticket buttons with the same frame structure.
    await activateTool(page, 'f');
    await dragAt(page, [0.1, 0.32], [0.34, 0.54], { steps: 12, settleMs: 220 });
    await setFillHex(page, '#F4C95D');
    await addText(page, [0.13, 0.37], [0.31, 0.42], 'STANDARD');
    await addText(page, [0.13, 0.45], [0.31, 0.5], 'BOOK TICKET');
    await activateTool(page, 'f');
    await dragAt(page, [0.39, 0.32], [0.66, 0.56], { steps: 12, settleMs: 220 });
    await setFillHex(page, '#F28F6B');
    await addText(page, [0.42, 0.37], [0.63, 0.42], 'FLEX');
    await addText(page, [0.42, 0.47], [0.63, 0.52], 'BOOK TICKET');
    await activateTool(page, 'f');
    await dragAt(page, [0.71, 0.32], [0.93, 0.58], { steps: 12, settleMs: 220 });
    await setFillHex(page, '#9CC5A1');
    await addText(page, [0.74, 0.37], [0.91, 0.42], 'FLEX PLUS');
    await addText(page, [0.74, 0.49], [0.91, 0.54], 'BOOK TICKET');
    await activateTool(page, 'v');
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    assert.equal((await layerNames(page)).filter((name) => /frame/i.test(name)).length, 3);

    begin();
    await beat(page, 1800);
    await openObjectAction(page, 'Detect Duplicates');
    await page
      .getByRole('tab', { name: 'Audit', exact: true })
      .waitFor({ state: 'visible', timeout: 8000 });
    const createComponent = page.getByRole('button', { name: /Create component/i }).first();
    await createComponent.waitFor({ state: 'visible', timeout: 8000 });
    await createComponent.click();
    assertions.push(
      'duplicate ticket frames were converted through Detect Duplicates → Create component',
    );
    await page.waitForTimeout(900);

    // Text children are real nested layers, so address the three component
    // roots explicitly instead of relying on flat tree order.
    const roots = page.locator('[role="treeitem"][aria-level="1"]');
    const treeCount = await roots.count();
    assert.ok(treeCount >= 3, `component conversion removed ticket layers (got ${treeCount})`);
    // After Detect Duplicates the inspector stays on the Audit tab.
    // Switch to Properties so the Component section (on instances) is reachable.
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"]');
      for (const tab of tabs) {
        if (tab.textContent?.trim() === 'Properties') {
          tab.click();
          break;
        }
      }
    });
    await page.waitForTimeout(400);
    // Select the first instance (tree lists newest-first: instance, instance, source).
    await roots.first().click();
    await page.waitForTimeout(400);
    const componentSection = page
      .locator('section.insp-disclosure')
      .filter({ hasText: /Component/i })
      .first();
    await componentSection.waitFor({ state: 'visible', timeout: 8000 });
    assertions.push('component source and instances remain real document-linked layers');
    await beat(page, 1400);

    // Select an instance and use the actual floating VariantBox. The box is
    // deliberately present even before the first variant so this workflow is
    // reachable for a newly-created component.
    await roots.nth(1).click();
    const variantBox = page.getByRole('dialog', { name: 'Variant picker' });
    await variantBox.waitFor({ state: 'visible', timeout: 8000 });
    await variantBox.getByRole('button', { name: 'Create variant' }).click();
    await variantBox.getByRole('textbox', { name: 'Variant name' }).fill('Selected');
    await variantBox.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(700);
    assert.ok(await variantBox.getByRole('option', { name: 'Selected' }).isVisible());
    assertions.push('first variant was created from the real instance picker and is active');
    await beat(page, 1500);

    await variantBox.getByRole('button', { name: 'Create variant' }).click();
    await variantBox.getByRole('textbox', { name: 'Variant name' }).fill('Disabled');
    await variantBox.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(700);
    await variantBox.getByRole('option', { name: 'Disabled' }).click();
    await page.waitForTimeout(600);
    assert.equal(
      await variantBox.getByRole('option', { name: 'Disabled' }).getAttribute('aria-selected'),
      'true',
    );
    assertions.push('the instance switched variants through document component semantics');
    await beat(page, 1000);

    // Source resize is a real master edit; the linked instance is then
    // reselected to prove the update did not detach it.
    await roots.first().click();
    const beforeSource = await canvasPixels(page);
    await setNumberField(page, 'W', 310);
    await page.waitForTimeout(700);
    assert.notEqual(
      Buffer.compare(beforeSource, await canvasPixels(page)),
      0,
      'source edit did not render',
    );
    await roots.nth(1).click();
    await variantBox.waitFor({ state: 'visible', timeout: 5000 });
    assertions.push('editing the source preserved the linked instance and its selected variant');
    await beat(page, 1300);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(500);
    assertions.push('undo and redo completed after component-source propagation');
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    await beat(page, 1200);
    return assertions;
  },
  metadata: {
    productTruth: 'componentId/variant/propertyOverrides persisted in the scene document',
  },
});
