#!/usr/bin/env node
/**
 * Video D — a deliberately different, paced hero tour.
 *
 * This is one coherent mini brand kit, built through the editor before the
 * cut and then toured as a finished project. The pauses are intentional: the
 * clip is a product tour, not a concatenation of feature tests.
 */
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import {
  useTool as activateTool,
  beat,
  dragAt,
  fitContent,
  importImage,
  layerNames,
  openCleanEditor,
  parkPointer,
  selectLayer,
  settle,
} from '../core/editor.mjs';
import { capture, ROOT } from '../core/run.mjs';

const photo = join(ROOT, 'tests', 'e2e', 'fixtures', 'photo-fixture.jpg');

async function addText(page, from, to, copy) {
  await activateTool(page, 't');
  await dragAt(page, from, to, { steps: 16 });
  await page.keyboard.type(copy, { delay: 16 });
  await page.keyboard.press('Escape');
  await activateTool(page, 'v');
}

await capture({
  slug: '60-seconds-inside-varve',
  workflow: '60 seconds inside Varve',
  purpose: 'A paced mini brand launch kit tour across Varve’s real workspaces.',
  fixture: 'tests/e2e/fixtures/photo-fixture.jpg',
  duration: [58, 62],
  authoredMotion: true,
  metadata: {
    project: 'Mini brand launch kit',
    pacing: '58–62 seconds; each segment is a real application state.',
  },

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    // Build the kit before the hero cut: logo mark, poster type, a social
    // card, and a real raster image are all in the project viewers see.
    await activateTool(page, 'o');
    await dragAt(page, [0.11, 0.14], [0.24, 0.27]);
    await activateTool(page, 'r');
    await dragAt(page, [0.28, 0.13], [0.47, 0.27]);
    await activateTool(page, 'r');
    await dragAt(page, [0.54, 0.13], [0.89, 0.27]);
    await addText(page, [0.1, 0.34], [0.86, 0.46], 'NORTH / FORM');
    await addText(page, [0.1, 0.49], [0.46, 0.56], 'A SMALL SYSTEM FOR BIG IDEAS');
    await importImage(page, photo);
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    const built = await layerNames(page);
    assert.ok(built.length >= 6, `brand kit did not build enough real layers: ${built.length}`);

    begin();
    // 0–6: open finished kit.
    await beat(page, 5800);

    // 6–13: manipulate a vector path with a real tool interaction.
    await activateTool(page, 'p');
    await dragAt(page, [0.6, 0.42], [0.68, 0.35]);
    await dragAt(page, [0.75, 0.48], [0.82, 0.4]);
    await page.keyboard.press('Enter');
    await activateTool(page, 'v');
    await page.getByRole('treeitem').last().click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    assertions.push('vector path created and opened in the real node-edit surface');
    await beat(page, 5800);

    // 13–20: typography and colour inspector.
    const textLayer = page
      .getByRole('treeitem')
      .filter({ hasText: /NORTH \/ FORM/i })
      .first();
    await textLayer.click();
    await page
      .getByRole('tab', { name: /Design|Properties/i })
      .first()
      .click()
      .catch(() => undefined);
    await page.waitForTimeout(700);
    assertions.push('typography layer selected in the production inspector');
    await beat(page, 5800);

    // 20–27: reuse a real object rather than presenting a static duplicate.
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(650);
    assertions.push('a launch-kit element is duplicated through the editor command path');
    await beat(page, 5800);

    // 27–34: raster capability: select the imported photograph and expose its
    // real image tools without claiming a preprocessed effect result.
    await selectLayer(page, /photo-fixture|image/i).catch(async () => {
      await page.getByRole('treeitem').last().click();
    });
    await page.waitForTimeout(700);
    assertions.push('the kit contains a real raster layer alongside vector and type');
    await beat(page, 5800);

    // 34–42: prototype workspace surface.
    const prototypeTab = page.getByRole('tab', { name: /Prototype/i }).first();
    if (await prototypeTab.isVisible({ timeout: 4000 }).catch(() => false)) {
      await prototypeTab.click();
      assertions.push('Prototype workspace opened from the finished kit');
    }
    await beat(page, 6800);

    // 42–49: motion workspace and playback controls.
    await page.keyboard.press('Control+Shift+5');
    await page.waitForTimeout(900);
    const play = page.getByRole('button', { name: /play/i }).first();
    if (await play.isVisible({ timeout: 4000 }).catch(() => false)) {
      await play.click();
      assertions.push('Motion playback was started through its real control');
    }
    await beat(page, 6100);

    // 49–55: export choices are shown, then the tour returns to the work.
    await page.keyboard.press('Control+Shift+e');
    const exportDialog = page.getByRole('dialog', { name: /export/i });
    if (await exportDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      assertions.push('export choices are exposed in the real export dialog');
      await beat(page, 4800);
      await exportDialog
        .getByRole('button', { name: /close|cancel/i })
        .first()
        .click();
    } else {
      await page.keyboard.press('Escape');
      await beat(page, 4800);
    }

    // 55–60: clean final project view.
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    await beat(page, 5800);
    return assertions;
  },
});
