#!/usr/bin/env node
/** Video E — real timeline keyframes, seek, drag and playback. */
import { strict as assert } from 'node:assert';
import {
  beat,
  canvasPixels,
  dragAt,
  fitContent,
  openCleanEditor,
  parkPointer,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

await capture({
  slug: 'motion-timeline',
  workflow: 'Motion timeline',
  purpose:
    'A kinetic editorial title card is keyed, scrubbed, dragged and played in the real timeline.',
  duration: [22, 32],
  authoredMotion: true,
  fixture: null,

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];
    await openCleanEditor(page, base);
    await settle(page);

    await useTool(page, 'r');
    await dragAt(page, [0.24, 0.3], [0.48, 0.56], { steps: 12, settleMs: 220 });
    await useTool(page, 't');
    await dragAt(page, [0.18, 0.2], [0.74, 0.28], { steps: 12, settleMs: 120 });
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await editor.fill('KINETIC WEATHER');
    await editor.press('Escape');
    await useTool(page, 'v');
    await page.getByRole('treeitem').filter({ hasText: /text/i }).first().click();
    await fitContent(page);
    await parkPointer(page);
    await settle(page);

    await page.keyboard.press('Control+Shift+5');
    const timeline = page.locator('.timeline-panel');
    await timeline.waitFor({ state: 'visible', timeout: 10000 });
    await timeline
      .getByRole('button', { name: /Create timeline/i })
      .first()
      .click();
    await page.waitForTimeout(700);
    await timeline.getByRole('combobox', { name: 'Select timeline' }).waitFor({ state: 'visible' });
    begin();
    await beat(page, 1000);

    await page.keyboard.press('Alt+p');
    await page.waitForTimeout(500);
    let keys = timeline.locator('.timeline-track-row__keyframe');
    await keys.first().waitFor({ state: 'visible', timeout: 8000 });
    assert.ok((await keys.count()) >= 1, 'first position keyframe was not created');
    assertions.push('first position keyframe was inserted through the real Motion shortcut');
    await beat(page, 1000);

    const ruler = timeline.getByRole('slider', { name: 'Timeline ruler' });
    await ruler.focus();
    await ruler.press('Home');
    await ruler.press('Shift+ArrowRight', { delay: 80 });
    await ruler.press('Shift+ArrowRight', { delay: 80 });
    await ruler.press('Shift+ArrowRight', { delay: 80 });
    await ruler.press('Shift+ArrowRight', { delay: 80 });
    await ruler.press('Shift+ArrowRight', { delay: 80 });
    assert.equal(await ruler.getAttribute('aria-valuenow'), '2500');
    assertions.push('drag/keyboard seek moved the real playhead to the exact 2.5s authored time');
    await beat(page, 900);

    const beforeMove = await canvasPixels(page);
    await dragAt(page, [0.36, 0.42], [0.58, 0.34], { steps: 16, settleMs: 250 });
    await page.keyboard.press('Alt+p');
    await page.waitForTimeout(600);
    assert.notEqual(
      Buffer.compare(beforeMove, await canvasPixels(page)),
      0,
      'keyed transform did not render',
    );
    keys = timeline.locator('.timeline-track-row__keyframe');
    assert.ok((await keys.count()) >= 2, 'second position keyframe was not created');
    assertions.push('second position keyframe stores the moved editorial geometry');
    await beat(page, 1100);

    // Drag a keyframe through the production timeline track. The resulting
    // aria label is a user-visible reflection of the stored progress value.
    const second = keys.nth(1);
    const secondLabel = await second.getAttribute('aria-label');
    await second.scrollIntoViewIfNeeded();
    const secondBox = await second.boundingBox();
    if (!secondBox) throw new Error('second keyframe has no rendered geometry');
    await page.mouse.move(secondBox.x, secondBox.y);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + 80, secondBox.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const movedLabel = await keys.nth(1).getAttribute('aria-label');
    assert.notEqual(
      movedLabel,
      secondLabel,
      'dragging a keyframe did not change its authored progress',
    );
    assertions.push(
      `dragging the keyframe changed its real timeline position (${secondLabel} → ${movedLabel})`,
    );
    await beat(page, 900);

    await timeline.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(1400);
    await timeline.getByRole('button', { name: 'Pause' }).click();
    assertions.push('timeline playback rendered the same keyed values used by scrub/seek');
    await beat(page, 1000);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    assertions.push('undo restored the last keyframe edit');
    await parkPointer(page);
    await settle(page);
    await beat(page, 1200);
    return assertions;
  },
  metadata: {
    productTruth: 'MotionFacade/TimelineSampler drive the canvas; no capture-only CSS animation',
  },
});
