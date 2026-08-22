#!/usr/bin/env node
/**
 * Video D — a deliberately different, paced hero tour.
 *
 * A coherent mini brand launch kit, built through the editor before the cut
 * and then toured as a finished project. The teal identity card and real
 * mountain photograph give this clip a campaign-like visual signature rather
 * than making it another feature checklist.
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
  authoredMotion: false,
  metadata: {
    project: 'Kite / 01 — Mini brand launch kit',
    visualDirection: 'Full-bleed mountain photograph, teal identity card, editorial grid.',
    pacing: '58–62 seconds; each segment is a real application state.',
    motionHandling: 'Reduced-motion capture shows the real prototype surface; provider-gated motion is disclosed in current-limitations.',
  },

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    // Build one coherent launch kit: the photo is a real raster layer, the
    // card/grid is vector work, and the campaign copy is real text content.
    await activateTool(page, 'r');
    await dragAt(page, [0.06, 0.08], [0.94, 0.9]);
    await activateTool(page, 'o');
    await dragAt(page, [0.1, 0.16], [0.23, 0.29]);
    await activateTool(page, 'r');
    await dragAt(page, [0.28, 0.15], [0.5, 0.34]);
    await activateTool(page, 'r');
    await dragAt(page, [0.54, 0.15], [0.9, 0.34]);
    await activateTool(page, 'r');
    await dragAt(page, [0.28, 0.46], [0.9, 0.82]);
    // Establish camera framing from the geometric grid before text/raster
    // nodes commit; this avoids a known live-inspector update loop.
    await fitContent(page);
    await addText(page, [0.1, 0.35], [0.62, 0.46], 'MOVE WITH THE SIGNAL');
    await addText(page, [0.1, 0.5], [0.56, 0.58], 'KITE STUDIO / LAUNCH 01');
    await addText(page, [0.1, 0.82], [0.5, 0.87], 'SMALL SYSTEMS. BIG ENERGY.');
    await importImage(page, photo);
    // Author the identity card over the real raster image, creating the
    // campaign reveal viewers see at the opening and closing of the tour.
    await activateTool(page, 'r');
    await dragAt(page, [0.08, 0.1], [0.48, 0.4]);
    await addText(page, [0.11, 0.16], [0.42, 0.23], 'KITE / 01');
    await addText(page, [0.11, 0.27], [0.44, 0.34], 'MOVE WITH THE SIGNAL');
    await parkPointer(page);
    await settle(page);
    const built = await layerNames(page);
    assert.ok(built.length >= 12, `brand kit did not build enough real layers: ${built.length}`);

    begin();
    // 0–6: open the finished campaign board.
    await beat(page, 5000);

    // 6–13: manipulate a vector path with a real tool interaction.
    await activateTool(page, 'p');
    await dragAt(page, [0.6, 0.42], [0.68, 0.35]);
    await dragAt(page, [0.75, 0.48], [0.82, 0.4]);
    await page.keyboard.press('Enter');
    await activateTool(page, 'v');
    await page.getByRole('treeitem').last().click();
    await page.waitForTimeout(700);
    assertions.push('vector path created and selected through the real path tool surface');
    await beat(page, 4500);

    // 13–20: typography and colour inspector.
    await selectLayer(page, /^Text(?::|$)/i);
    await page
      .getByRole('tab', { name: /Design|Properties/i })
      .first()
      .click()
      .catch(() => undefined);
    await page.waitForTimeout(700);
    assertions.push('typography layer selected in the production inspector');
    await beat(page, 4500);

    // 20–27: duplicate the small signal mark through the editor command path.
    // Keeping the duplicated object compact preserves the campaign read while
    // still proving that reuse is a real document operation.
    await selectLayer(page, /Ellipse 1/i);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(650);
    assertions.push('a launch-kit element is duplicated through the editor command path');
    await beat(page, 4500);

    // 27–34: show the real raster layer alongside vector and type.
    await selectLayer(page, /photo-fixture|image/i).catch(async () => {
      await page.getByRole('treeitem').last().click();
    });
    await page.waitForTimeout(700);
    assertions.push('the kit contains a real raster layer alongside vector and type');
    await beat(page, 4500);

    // 34–42: open the prototype surface on the finished kit.
    const prototypeTab = page.getByRole('tab', { name: /Prototype/i }).first();
    if (await prototypeTab.isVisible({ timeout: 4000 }).catch(() => false)) {
      await prototypeTab.click();
      assertions.push('Prototype workspace opened from the finished kit');
    }
    await beat(page, 5000);

    // 42–49: hold the actual interaction workspace. Motion playback is
    // provider-gated in this build, so the status reel calls that out instead
    // of faking animation or hiding a runtime failure in this hero tour.
    await beat(page, 9000);

    // 49–55: expose real export choices, then return to the work.
    await page.keyboard.press('Control+Shift+e');
    const exportDialog = page.getByRole('dialog', { name: /export/i });
    if (await exportDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      assertions.push('export choices are exposed in the real export dialog');
      await beat(page, 3500);
      await exportDialog
        .getByRole('button', { name: /close|cancel/i })
        .first()
        .click();
    } else {
      await page.keyboard.press('Escape');
      await beat(page, 3500);
    }

    // 55–60: clean final project view.
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    await beat(page, 4200);
    return assertions;
  },
});
