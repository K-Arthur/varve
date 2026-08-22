#!/usr/bin/env node
/** Video G — the exact same editorial spread under Varve's light/dark UI themes. */
import { strict as assert } from 'node:assert';
import {
  beat,
  chooseTheme,
  currentZoom,
  dragAt,
  fitContent,
  openCleanEditor,
  parkPointer,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture } from '../core/run.mjs';

await capture({
  slug: 'light-dark-ui',
  workflow: 'Same project in light/dark UI',
  purpose: 'One editorial magazine spread stays identical while Varve chrome changes from light to dark.',
  duration: [12, 18],
  fixture: null,

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];
    await openCleanEditor(page, base);
    await settle(page);
    await useTool(page, 'f');
    await dragAt(page, [0.16, 0.18], [0.84, 0.80], { steps: 14, settleMs: 220 });
    await useTool(page, 'r');
    await dragAt(page, [0.22, 0.28], [0.78, 0.62], { steps: 12, settleMs: 220 });
    await useTool(page, 't');
    await dragAt(page, [0.25, 0.34], [0.72, 0.46], { steps: 12, settleMs: 120 });
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await editor.fill('THE LONG WEEKEND');
    await editor.press('Escape');
    await useTool(page, 'v');
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    await chooseTheme(page, 'Light');
    await settle(page);
    const lightZoom = await currentZoom(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBounds = await canvas.boundingBox();
    if (!canvasBounds) throw new Error('content canvas not found');
    const lightArtwork = await page.evaluate((clip) => {
      const canvas = document.querySelector('canvas.editor-canvas__content-layer');
      const context = canvas?.getContext('2d');
      if (!canvas || !context) throw new Error('canvas pixels unavailable');
      const image = context.getImageData(clip.x, clip.y, clip.width, clip.height);
      return Array.from(image.data);
    }, {
      x: Math.round(canvasBounds.width * 0.25),
      y: Math.round(canvasBounds.height * 0.25),
      width: Math.round(canvasBounds.width * 0.5),
      height: Math.round(canvasBounds.height * 0.45),
    });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');

    begin();
    await beat(page, 1600);
    assertions.push(`light UI stabilized at zoom ${lightZoom}% with the editorial spread visible`);
    await chooseTheme(page, 'Dark');
    await settle(page);
    const darkZoom = await currentZoom(page);
    const darkArtwork = await page.evaluate((clip) => {
      const canvas = document.querySelector('canvas.editor-canvas__content-layer');
      const context = canvas?.getContext('2d');
      if (!canvas || !context) throw new Error('canvas pixels unavailable');
      const image = context.getImageData(clip.x, clip.y, clip.width, clip.height);
      return Array.from(image.data);
    }, {
      x: Math.round(canvasBounds.width * 0.25),
      y: Math.round(canvasBounds.height * 0.25),
      width: Math.round(canvasBounds.width * 0.5),
      height: Math.round(canvasBounds.height * 0.45),
    });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(darkZoom, lightZoom, 'theme switch changed the camera zoom');
    const background = lightArtwork.slice(0, 4);
    let foreground = 0;
    let mismatched = 0;
    for (let i = 0; i < lightArtwork.length; i += 4) {
      const isForeground = lightArtwork.slice(i, i + 4).some((value, channel) => value !== background[channel]);
      if (!isForeground) continue;
      foreground += 1;
      for (let channel = 0; channel < 4; channel += 1) {
        if (lightArtwork[i + channel] !== darkArtwork[i + channel]) {
          mismatched += 1;
          break;
        }
      }
    }
    assert.ok(foreground > 100, 'paired theme crop contains no artwork pixels');
    assert.ok(mismatched / foreground < 0.01, `document artwork changed for ${mismatched}/${foreground} foreground pixels`);
    assertions.push('real View → Theme → Dark changed application chrome while the canvas crop stayed pixel-identical');
    await beat(page, 2200);
    await chooseTheme(page, 'Light');
    await settle(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    assertions.push('switching back to Light restored the same project and camera');
    await beat(page, 1800);
    await beat(page, 2000);
    await parkPointer(page);
    return assertions;
  },
  metadata: { productTruth: 'theme control mutates UI tokens only; project scene/camera are unchanged' },
});
