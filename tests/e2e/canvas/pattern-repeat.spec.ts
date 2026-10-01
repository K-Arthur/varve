/**
 * Pattern repeat E2E — real UI interaction with real canvas pixels.
 *
 * Locks in the v2.32 pattern contract, which unit tests can only approximate:
 *  - a generated procedural pattern actually paints, and paints a *repeating*
 *    field (the pixel line is periodic at the tile period);
 *  - switching the repeat arrangement changes the field while preserving the
 *    horizontal period;
 *  - Randomize changes the motif, and an unrelated control does not re-roll it.
 *
 * The period is measured from the rendered canvas rather than assumed, so the
 * spec does not silently depend on the camera zoom or device pixel ratio.
 */

import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { selectFillType } from '../helpers/editor-helpers';
import { navigateToCleanEditor } from '../helpers/nav';

async function createRect(page: Page): Promise<{ box: { x: number; y: number } }> {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 350);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 300, box.y + 250);
  await page.waitForTimeout(400);
  return { box };
}

async function createEllipse(page: Page): Promise<{ box: { x: number; y: number } }> {
  await page.keyboard.press('o');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 350);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 300, box.y + 250);
  await page.waitForTimeout(400);
  return { box };
}

type Rgba = [number, number, number, number];

async function samplePixels(page: Page, points: Array<{ x: number; y: number }>): Promise<Rgba[]> {
  const sampled = await page.evaluate((pts) => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!canvas) return pts.map(() => [0, 0, 0, 0]);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return pts.map(() => [0, 0, 0, 0]);
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return pts.map((p) => {
      const d = ctx.getImageData(
        Math.round((p.x - r.left) * dpr),
        Math.round((p.y - r.top) * dpr),
        1,
        1,
      ).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
    });
  }, points);
  return sampled as Rgba[];
}

async function sampleLine(page: Page, box: { x: number; y: number }, y: number): Promise<Rgba[]> {
  const N = 240;
  return samplePixels(
    page,
    Array.from({ length: N }, (_, i) => ({ x: box.x + 160 + i, y })),
  );
}

/**
 * A 2D digest of the painted object. A single scanline can coincidence-match
 * after an arrangement change (a half-drop shear is a *phase* shift on any one
 * row), so the arrangement and seed tests compare a 2D sample.
 */
async function regionSignature(page: Page, box: { x: number; y: number }): Promise<string> {
  const points: Array<{ x: number; y: number }> = [];
  // Avoid regular sampling intervals that can alias against dot/stripe tiles.
  // These relatively prime steps cover most of the object at several phases.
  for (let gy = 0; gy < 14; gy++) {
    for (let gx = 0; gx < 24; gx++) {
      points.push({ x: box.x + 180 + gx * 11, y: box.y + 170 + gy * 13 });
    }
  }
  const sampled = await samplePixels(page, points);
  let hash = 2166136261;
  for (const p of sampled) {
    for (const channel of p) {
      hash ^= channel;
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16);
}

function close(a: Rgba, b: Rgba, tol = 10): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tol &&
    Math.abs(a[1] - b[1]) <= tol &&
    Math.abs(a[2] - b[2]) <= tol &&
    Math.abs(a[3] - b[3]) <= tol
  );
}

/** Smallest shift at which the sampled line reproduces itself. */
function smallestPeriod(line: Rgba[]): { period: number; ratio: number } {
  let best = { period: 0, ratio: 0 };
  for (let period = 6; period <= 180; period++) {
    let matches = 0;
    let total = 0;
    for (let i = 0; i + period < line.length; i++) {
      total++;
      if (close(line[i]!, line[i + period]!)) matches++;
    }
    const ratio = total > 0 ? matches / total : 0;
    if (ratio >= 0.95) return { period, ratio };
    if (ratio > best.ratio) best = { period, ratio };
  }
  return best;
}

function distinctColours(line: Rgba[]): number {
  const seen = new Set<string>();
  for (const p of line) seen.add(`${p[0]},${p[1]},${p[2]},${p[3]}`);
  return seen.size;
}

async function useGenerator(page: Page, label: string): Promise<void> {
  await page.getByRole('combobox', { name: /Generator/i }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.waitForTimeout(900);
}

async function inspectSvgSupertile(
  page: Page,
  svg: string,
): Promise<{
  distinctPixels: number;
  visiblePixels: number;
  differentFromXRepeat: number;
  differentFromYRepeat: number;
}> {
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('exported SVG did not decode'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D canvas unavailable');
    const repeat = context.createPattern(image, 'repeat');
    if (!repeat) throw new Error('could not tile the exported supercell');
    context.fillStyle = repeat;
    context.fillRect(0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(image.src);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colours = new Set<string>();
    let visiblePixels = 0;
    let differentFromXRepeat = 0;
    let differentFromYRepeat = 0;
    for (let y = 0; y < 400; y++) {
      for (let x = 0; x < 300; x++) {
        const offset = (y * canvas.width + x) * 4;
        const xRepeatOffset = (y * canvas.width + x + 300) * 4;
        const yRepeatOffset = ((y + 400) * canvas.width + x) * 4;
        const pixel = `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`;
        colours.add(pixel);
        if (pixels[offset + 3]! > 0) visiblePixels++;
        for (let channel = 0; channel < 4; channel++) {
          if (pixels[offset + channel] !== pixels[xRepeatOffset + channel]) {
            differentFromXRepeat++;
          }
          if (pixels[offset + channel] !== pixels[yRepeatOffset + channel]) {
            differentFromYRepeat++;
          }
        }
      }
    }
    return {
      distinctPixels: colours.size,
      visiblePixels,
      differentFromXRepeat,
      differentFromYRepeat,
    };
  }, svg);
}

test.describe('pattern repeat', () => {
  test('creates a reusable vector source, applies it, and makes one use unique', async ({
    page,
  }) => {
    test.setTimeout(240000);
    const historyWarnings: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('updateDoc called outside transaction')) {
        historyWarnings.push(message.text());
      }
    });
    await navigateToCleanEditor(page);
    await createEllipse(page);
    await page.getByRole('button', { name: 'Paint Library', exact: true }).click();
    await page.getByRole('button', { name: 'Pattern Library', exact: true }).click();

    await page.getByRole('button', { name: /create from selection/i }).click();
    const entries = page.locator('ul[aria-label="Reusable patterns"] > li');
    await expect(entries).toHaveCount(1);
    const entry = entries.first();
    const name = await entry.locator('.insp-paint-library__name').innerText();
    await expect(entry).toContainText('vector');
    const swatchLayout = await entry.locator('.insp-pattern-library__swatch').evaluate((swatch) => {
      const bounds = swatch.getBoundingClientRect();
      const canvas = swatch.querySelector('canvas');
      const hint = swatch.querySelector('.insp-hint');
      const canvasBounds = canvas?.getBoundingClientRect();
      return {
        canvasContained:
          Boolean(canvasBounds) &&
          canvasBounds!.left >= bounds.left &&
          canvasBounds!.right <= bounds.right &&
          canvasBounds!.top >= bounds.top &&
          canvasBounds!.bottom <= bounds.bottom,
        hintDisplay: hint ? getComputedStyle(hint).display : 'missing',
      };
    });
    expect(swatchLayout.canvasContained, 'repeat artwork must stay inside its swatch').toBe(true);
    expect(swatchLayout.hintDisplay, 'the full preview hint must not spill into the list').toBe(
      'none',
    );
    await entry.getByRole('button', { name: `Edit ${name} definition settings` }).click();
    const settings = entry.getByRole('group', { name: `Definition settings for ${name}` });
    await expect(settings).toBeVisible();
    const geometry = await settings.evaluate((fieldset) => {
      const input = fieldset.querySelector('input[aria-label="Pattern definition name"]');
      const legend = fieldset.querySelector('legend');
      const nameLabel = fieldset.querySelector(':scope > label:first-of-type');
      if (!input || !legend || !nameLabel)
        return {
          fieldset: null,
          legend: null,
          nameLabel: null,
          inside: false,
          width: 0,
          labelsSeparated: false,
        };
      const bounds = fieldset.getBoundingClientRect();
      const inputBounds = input.getBoundingClientRect();
      const legendBounds = legend.getBoundingClientRect();
      const labelBounds = nameLabel.getBoundingClientRect();
      return {
        inside: inputBounds.left >= bounds.left && inputBounds.right <= bounds.right,
        width: inputBounds.width,
        labelsSeparated: labelBounds.top >= legendBounds.bottom - 1,
      };
    });
    expect(geometry.inside, 'settings input must fit inside the compact inspector').toBe(true);
    expect(geometry.width).toBeGreaterThan(120);
    expect(geometry.labelsSeparated, 'legend and first field label must not overlap').toBe(true);
    await settings.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/pattern-library/03-definition-settings.png' });
    const arrangement = page.getByRole('combobox', { name: 'Definition repeat arrangement' });
    await arrangement.click();
    await page.getByRole('option', { name: 'Brick', exact: true }).click();
    await expect(arrangement).toContainText('Brick');
    await expect(settings.getByLabel('Row offset')).toHaveValue('0.5');
    const downloadPromise = page.waitForEvent('download');
    await entry.getByRole('button', { name: `Export ${name} source tile as SVG` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${name.replace(/[^a-z0-9_-]+/gi, '-')}-tile.svg`);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const tileSvg = await readFile(downloadPath!, 'utf8');
    expect(tileSvg).toContain('<svg');
    expect(tileSvg).toContain('viewBox=');
    const supertileDownloadPromise = page.waitForEvent('download');
    await entry.getByRole('button', { name: `Export ${name} repeating supertile as SVG` }).click();
    const supertileDownload = await supertileDownloadPromise;
    expect(supertileDownload.suggestedFilename()).toBe(
      `${name.replace(/[^a-z0-9_-]+/gi, '-')}-supertile.svg`,
    );
    const supertilePath = await supertileDownload.path();
    expect(supertilePath).toBeTruthy();
    const supertileSvg = await readFile(supertilePath!, 'utf8');
    await supertileDownload.saveAs('test-results/pattern-library/05-supertile.svg');
    expect(supertileSvg).toContain('viewBox="0 0 300 400"');
    expect(supertileSvg).toContain('clip-path="url(#pattern-supertile-clip)"');
    const repeatPixels = await inspectSvgSupertile(page, supertileSvg);
    expect(repeatPixels.distinctPixels).toBeGreaterThan(1);
    expect(repeatPixels.visiblePixels).toBeGreaterThan(0);
    expect(repeatPixels.differentFromXRepeat).toBe(0);
    expect(repeatPixels.differentFromYRepeat).toBe(0);
    await page.mouse.move(640, 10);
    const microHint = page.locator('.micro-hint');
    if (await microHint.isVisible().catch(() => false)) {
      await microHint.getByRole('button', { name: 'Dismiss hint' }).click();
      await microHint.waitFor({ state: 'hidden' });
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/pattern-library/01-vector-source.png' });

    await entry.getByRole('button', { name: `Apply ${name} to selection` }).click();
    await expect(entry.locator('.insp-paint-library__badge')).toContainText('1 use');
    await entry.getByRole('button', { name: `Make ${name} unique for this fill` }).click();
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(1)).toContainText('vector');
    await page.screenshot({ path: 'test-results/pattern-library/02-unique-use.png' });

    await page.keyboard.press('Control+z');
    await expect(entries).toHaveCount(1);
    await expect(entry.locator('.insp-paint-library__badge')).toContainText('1 use');
    await page.keyboard.press('Control+Shift+z');
    await expect(entries).toHaveCount(2);
    expect(historyWarnings).toEqual([]);
  });

  test('replaces a definition source with an embedded raster tile', async ({ page }) => {
    test.setTimeout(240000);
    const historyWarnings: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('updateDoc called outside transaction')) {
        historyWarnings.push(message.text());
      }
    });
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    await page.getByRole('button', { name: 'Paint Library', exact: true }).click();
    await page.getByRole('button', { name: 'Pattern Library', exact: true }).click();
    await page.getByRole('button', { name: /create from selection/i }).click();

    const entries = page.locator('ul[aria-label="Reusable patterns"] > li');
    await expect(entries).toHaveCount(1);
    const entry = entries.first();
    const name = await entry.locator('.insp-paint-library__name').innerText();
    await expect(entry).toContainText('vector');
    await entry.getByRole('button', { name: `Apply ${name} to selection` }).click();
    await expect(entry.locator('.insp-paint-library__badge')).toContainText('1 use');
    await entry.getByRole('button', { name: `Replace ${name} source` }).click();

    const pngDataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 3;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D canvas unavailable');
      context.fillStyle = '#1c92c5';
      context.fillRect(0, 0, 1, 3);
      context.fillStyle = '#e46730';
      context.fillRect(1, 0, 1, 3);
      return canvas.toDataURL('image/png');
    });
    const buffer = Buffer.from(pngDataUrl.split(',')[1] ?? '', 'base64');
    await page.locator('input.insp-pattern-library__file').setInputFiles({
      name: 'replacement-tile.png',
      mimeType: 'image/png',
      buffer,
    });
    await expect(entry.locator('.insp-paint-library__badge')).toContainText('raster · 2 by 3');
    await expect(entry.locator('.insp-paint-library__badge')).toContainText('1 use');
    await page.waitForTimeout(500);
    const line = await sampleLine(page, box, box.y + 250);
    expect(distinctColours(line), 'the replaced source must paint the linked fill').toBeGreaterThan(
      1,
    );
    const { period, ratio } = smallestPeriod(line);
    expect(ratio, 'the imported raster field should remain periodic').toBeGreaterThan(0.9);
    expect(period).toBeLessThan(8);
    await page.screenshot({ path: 'test-results/pattern-library/04-replaced-raster.png' });
    expect(historyWarnings).toEqual([]);
  });

  test('a generated pattern paints a field that repeats at the tile period', async ({ page }) => {
    test.setTimeout(240000);
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    await selectFillType(page, 'Pattern');
    await page.getByRole('button', { name: /generate pattern/i }).click();
    await page.waitForTimeout(1200);

    // A deterministic generator makes the period assertion meaningful.
    await useGenerator(page, 'Checkerboard');

    const line = await sampleLine(page, box, box.y + 260);
    expect(distinctColours(line), 'the pattern must not paint a flat fill').toBeGreaterThan(1);

    const { period, ratio } = smallestPeriod(line);
    expect(ratio, `no period found (best ${period} at ${ratio.toFixed(2)})`).toBeGreaterThan(0.95);
    expect(period).toBeGreaterThanOrEqual(10);

    // The repeat holds at an independent offset (a second row), which rules out
    // a one-off coincidence on a single scanline.
    const line2 = await sampleLine(page, box, box.y + 300);
    let matches = 0;
    let total = 0;
    for (let i = 0; i + period < line2.length; i++) {
      total++;
      if (close(line2[i]!, line2[i + period]!)) matches++;
    }
    expect(matches / total).toBeGreaterThan(0.9);

    await page.screenshot({ path: 'test-results/pattern-repeat/01-generated-grid.png' });
  });

  test('changing the arrangement alters the field and keeps the horizontal period', async ({
    page,
  }) => {
    test.setTimeout(240000);
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    await selectFillType(page, 'Pattern');
    await page.getByRole('button', { name: /generate pattern/i }).click();
    await page.waitForTimeout(1200);
    // Checkerboard is invariant under a half-cell phase shift, so it cannot
    // prove that a staggered arrangement changed the visible field.
    await useGenerator(page, 'Dots');

    const gridLine = await sampleLine(page, box, box.y + 260);
    const grid = smallestPeriod(gridLine);
    expect(grid.ratio).toBeGreaterThan(0.95);
    const gridRegion = await regionSignature(page, box);

    await page.getByRole('combobox', { name: /Arrangement/i }).click();
    await page.getByRole('option', { name: 'Half-drop', exact: true }).click();
    await page.waitForTimeout(1000);

    const halfDropLine = await sampleLine(page, box, box.y + 260);
    // The arrangement genuinely changed the painted field (compare the whole
    // object: a single scanline can match a phase-shifted row by coincidence).
    expect(await regionSignature(page, box)).not.toBe(gridRegion);
    // ...and the result is still a repeating field (the honest invariant:
    // half-drop can change the *fundamental* period for a motif that is
    // symmetric under a half-tile shift, so only recurrence is required).
    const halfDrop = smallestPeriod(halfDropLine);
    expect(halfDrop.ratio, 'half-drop must still repeat').toBeGreaterThan(0.92);
    expect(halfDrop.period).toBeGreaterThanOrEqual(6);

    await page.screenshot({ path: 'test-results/pattern-repeat/02-half-drop.png' });
  });

  test('Randomize re-rolls the motif once; an unrelated control does not', async ({ page }) => {
    test.setTimeout(240000);
    await navigateToCleanEditor(page);
    const { box } = await createRect(page);
    await selectFillType(page, 'Pattern');
    await page.getByRole('button', { name: /generate pattern/i }).click();
    await page.waitForTimeout(1200);
    // Dots are seed-dependent; a checkerboard would not move at all.
    await useGenerator(page, 'Dots');

    const before = await regionSignature(page, box);
    await page.getByRole('button', { name: /randomize/i }).click();
    await page.waitForTimeout(1200);
    const rerolled = await regionSignature(page, box);
    expect(rerolled, 'Randomize must choose a new seed').not.toBe(before);

    // Toggling an unrelated control (mirror) must not re-roll the artwork.
    // `force` is required because the styled checkbox paints its own box over
    // the visually-hidden native input; the input is still the real control.
    await page.getByRole('checkbox', { name: /mirror across/i }).check({ force: true });
    await page.waitForTimeout(900);
    await page.getByRole('checkbox', { name: /mirror across/i }).uncheck({ force: true });
    await page.waitForTimeout(900);
    const afterToggle = await regionSignature(page, box);
    expect(afterToggle, 'an unrelated edit must not reroll the seed').toBe(rerolled);

    await page.screenshot({ path: 'test-results/pattern-repeat/03-seed.png' });
  });
});
