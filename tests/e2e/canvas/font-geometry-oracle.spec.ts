/**
 * Oracles for the two defects this suite exists to catch.
 *
 * 1. Typography that only becomes correct once you touch the object. A real
 *    font-readiness event is fired and the frame diagnostics are read back:
 *    a `font-load` redraw must appear with nothing clicked, and selecting the
 *    text afterwards must not move a single glyph pixel.
 *
 * 2. Geometry that describes fewer lines than are painted. The selection
 *    rectangle is compared against the ink actually on the canvas, so a box
 *    that covers the first line of three fails even when it looks plausible.
 */

import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

interface CanvasImage {
  width: number;
  height: number;
  data: number[];
}

async function readCanvas(page: Page): Promise<CanvasImage> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('content canvas is not readable');
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: Array.from(image.data) };
  });
}

function differingPixels(before: CanvasImage, after: CanvasImage): number {
  if (before.data.length !== after.data.length) return Number.POSITIVE_INFINITY;
  let changed = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    if (
      Math.abs((before.data[i] ?? 0) - (after.data[i] ?? 0)) > 3 ||
      Math.abs((before.data[i + 1] ?? 0) - (after.data[i + 1] ?? 0)) > 3 ||
      Math.abs((before.data[i + 2] ?? 0) - (after.data[i + 2] ?? 0)) > 3
    ) {
      changed++;
    }
  }
  return changed;
}

/**
 * Bounding box of painted ink, in CSS pixels relative to the canvas element.
 *
 * The dominant colour is taken as the page background rather than assumed, so
 * this works on whichever theme the run happens to use.
 */
async function inkBounds(
  page: Page,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('content canvas is not readable');
    const { width, height } = canvas;
    const image = context.getImageData(0, 0, width, height).data;

    // Alpha is part of the comparison. The content layer is transparent where
    // nothing is drawn, and antialiased dark glyphs on it have RGB near zero —
    // indistinguishable from transparent black unless alpha is considered.
    const counts = new Map<number, number>();
    for (let i = 0; i < image.length; i += 4) {
      const key =
        ((image[i] ?? 0) << 24) |
        ((image[i + 1] ?? 0) << 16) |
        ((image[i + 2] ?? 0) << 8) |
        (image[i + 3] ?? 0);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let background = 0;
    let best = -1;
    for (const [key, count] of counts) {
      if (count > best) {
        best = count;
        background = key;
      }
    }
    const bg = [
      (background >>> 24) & 0xff,
      (background >>> 16) & 0xff,
      (background >>> 8) & 0xff,
      background & 0xff,
    ];

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let differs = false;
        for (let c = 0; c < 4; c++) {
          if (Math.abs((image[i + c] ?? 0) - (bg[c] ?? 0)) > 24) {
            differs = true;
            break;
          }
        }
        if (differs) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    return {
      x: minX / scale,
      y: minY / scale,
      w: (maxX - minX + 1) / scale,
      h: (maxY - minY + 1) / scale,
    };
  });
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function canvasBox(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  // The dev server can be recompiling under concurrent agent load; the shared
  // navigate helper already budgets minutes for first paint.
  await canvas.waitFor({ state: 'visible', timeout: 120000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('editor canvas has no bounds');
  return { canvas, box };
}

/** The selection overlay rectangle, in CSS pixels relative to the canvas. */
async function selectionRect(page: Page, canvasOrigin: { x: number; y: number }) {
  const rect = page.locator('svg[role="presentation"] rect').filter({ visible: true }).first();
  await expect(rect).toBeVisible();
  const box = await rect.boundingBox();
  if (!box) throw new Error('selection overlay has no bounds');
  return { x: box.x - canvasOrigin.x, y: box.y - canvasOrigin.y, w: box.width, h: box.height };
}

test.describe('font readiness', () => {
  test('a face becoming usable repaints the canvas with nothing clicked', async ({
    page,
  }, testInfo) => {
    // `?perf=1` installs the frame-diagnostics handle. Every frame records the
    // reason it was drawn, so this asserts the mechanism directly instead of
    // inferring it from pixels: a `font-load` frame must appear on its own,
    // with no pointer, keyboard, or camera input between the trigger and the
    // assertion.
    await navigateToEditor(page, '/?perf=1');
    const { canvas, box } = await canvasBox(page);
    const hasPerf = await page.evaluate(
      () => typeof (window as { __varvePerf?: unknown }).__varvePerf === 'object',
    );
    expect(hasPerf, 'perf diagnostics handle should be installed by ?perf=1').toBe(true);

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 220, box.y + 180);
    await page.keyboard.insertText('Typography readiness');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 20, box.y + 20);
    await settle(page);

    const before = await readCanvas(page);
    await canvas.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('01-before-font-event.png'),
    });

    const marker = await page.evaluate(() => {
      const perf = (
        window as {
          __varvePerf?: { getLast: () => { committedAt?: number } | null };
        }
      ).__varvePerf;
      return perf?.getLast()?.committedAt ?? performance.now();
    });

    // Clone a face from the page's own @font-face rules. Resource timing
    // entries are not portable across Chromium installations. FontFace#load
    // after add() does not consistently emit loadingdone in Chromium, so the
    // test completes the same public FontFaceSet event path explicitly after
    // loading a real page payload.
    const triggered = await page.evaluate(async () => {
      const events: string[] = [];
      document.fonts.addEventListener('loadingdone', () => events.push('loadingdone'));
      document.fonts.addEventListener('loadingerror', () => events.push('loadingerror'));
      let source = '';
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (!(rule instanceof CSSFontFaceRule)) continue;
            if (rule.style.getPropertyValue('font-family').includes('Geist')) {
              source = rule.style.getPropertyValue('src');
              break;
            }
          }
        } catch {
          // Cross-origin stylesheets are not readable from the test page.
        }
        if (source) break;
      }
      if (!source) return 'no-face-rule';
      const face = new FontFace('VarveReadinessProbe', source);
      document.fonts.add(face);
      await face.load();
      document.fonts.dispatchEvent(new Event('loadingdone'));
      return `${events.join(',')}:loaded`;
    });
    expect(triggered, 'a font payload should be available to re-register').toContain('loaded');

    // Nothing is interacted with here. Give the subscriber its frame.
    await settle(page);
    await settle(page);
    await settle(page);

    const frames = await page.evaluate((since: number) => {
      const perf = (
        window as {
          __varvePerf?: {
            getFrames: (n: number) => Array<{ committedAt?: number; redrawReason?: string }>;
          };
        }
      ).__varvePerf;
      return (perf?.getFrames(64) ?? []).filter(
        (frame) => (frame.committedAt ?? Number.NEGATIVE_INFINITY) > since,
      );
    }, marker);

    expect(
      frames.map((frame) => frame.redrawReason),
      `font readiness must schedule an authoritative redraw by itself: ${JSON.stringify(frames)}`,
    ).toContain('font-load');

    await canvas.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('02-after-font-event-no-interaction.png'),
    });

    // And the reported symptom: selecting the object must not be what fixes
    // the typography. Compare glyph pixels either side of the selection.
    const settled = await readCanvas(page);
    await page.mouse.click(box.x + 240, box.y + 185);
    await settle(page);
    const selected = await readCanvas(page);
    await canvas.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('03-after-selection.png'),
    });

    // The content layer carries no selection chrome — the overlay is a
    // separate SVG — so any difference here is glyph pixels moving.
    expect(
      differingPixels(settled, selected),
      'selecting text must not change the pixels the text is drawn with',
    ).toBe(0);
    expect(before.width).toBe(selected.width);
  });
});

test.describe('multi-line selection geometry', () => {
  test('the selection box encloses every painted line', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    const { canvas, box } = await canvasBox(page);

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 220, box.y + 160);
    await page.keyboard.insertText('First line\nSecond line\nThird line');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await settle(page);

    // Ink first, while nothing is selected: the overlay would pollute it.
    await expect
      .poll(() => inkBounds(page), {
        message: 'three lines of text should paint before measuring their bounds',
      })
      .not.toBeNull();
    const ink = await inkBounds(page);
    await canvas.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('multiline-ink.png'),
    });
    expect(ink, 'three lines of text should have painted something').not.toBeNull();

    await page.mouse.click(box.x + 240, box.y + 168);
    await settle(page);
    const selection = await selectionRect(page, box);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('multiline-selection.png'),
    });

    const tolerance = 4;
    expect(selection.y).toBeLessThanOrEqual((ink?.y ?? 0) + tolerance);
    expect(selection.y + selection.h).toBeGreaterThanOrEqual(
      (ink?.y ?? 0) + (ink?.h ?? 0) - tolerance,
    );
    expect(selection.x).toBeLessThanOrEqual((ink?.x ?? 0) + tolerance);
    expect(selection.x + selection.w).toBeGreaterThanOrEqual(
      (ink?.x ?? 0) + (ink?.w ?? 0) - tolerance,
    );
  });

  test('later lines are clickable, not just the first', async ({ page }) => {
    await navigateToEditor(page);
    const { box } = await canvasBox(page);

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 220, box.y + 160);
    await page.keyboard.insertText('First line\nSecond line\nThird line');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 20, box.y + 20);
    await settle(page);

    const ink = await inkBounds(page);
    expect(ink).not.toBeNull();
    // Aim at the vertical centre of the last line's band.
    const lastLineY = box.y + (ink?.y ?? 0) + (ink?.h ?? 0) - 6;
    await page.mouse.click(box.x + (ink?.x ?? 0) + 10, lastLineY);
    await settle(page);

    await expect(
      page.locator('svg[role="presentation"] rect').filter({ visible: true }).first(),
    ).toBeVisible();
  });

  test('the box grows live while a newline is being typed', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    const { canvas, box } = await canvasBox(page);

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 220, box.y + 160);
    await page.keyboard.insertText('First line');
    await settle(page);

    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    const oneLine = await editor.boundingBox();

    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Second line');
    // The overlay commits keystrokes on a short coalescing timer.
    await page.waitForTimeout(300);
    await settle(page);
    const twoLines = await editor.boundingBox();
    await canvas.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('live-editing-two-lines.png'),
    });

    expect(twoLines?.height ?? 0).toBeGreaterThan(oneLine?.height ?? 0);

    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await settle(page);
    const ink = await inkBounds(page);
    await page.mouse.click(box.x + 240, box.y + 168);
    await settle(page);
    const selection = await selectionRect(page, box);
    expect(selection.y + selection.h).toBeGreaterThanOrEqual((ink?.y ?? 0) + (ink?.h ?? 0) - 4);
  });
});

test.describe('area text', () => {
  test('resizing the box changes the container, not the type size', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    const { box } = await canvasBox(page);

    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 160, 380, 260);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await editor.fill('An area text box that wraps across more than one line of type.');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 260, box.y + 190);
    await settle(page);

    // Position & Size is expanded by default; these are plain spinbuttons.
    // NumberField's accessible name is `${label} (${unit})`.
    const widthField = page.getByRole('spinbutton', { name: 'W (px)', exact: true });
    const sizeField = page.getByRole('spinbutton', { name: 'Size (px)', exact: true });
    await expect(widthField).toBeVisible({ timeout: 15000 });
    const widthBefore = Number.parseFloat(await widthField.inputValue());
    const sizeBefore = await sizeField.inputValue().catch(() => null);

    const selection = await selectionRect(page, box);
    const handleX = box.x + selection.x + selection.w;
    const handleY = box.y + selection.y + selection.h / 2;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 90, handleY, { steps: 10 });
    await page.mouse.up();
    await settle(page);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('area-text-after-widen.png'),
      fullPage: false,
    });

    const widthAfter = Number.parseFloat(await widthField.inputValue());
    expect(widthAfter, 'the container must follow the handle').toBeGreaterThan(widthBefore + 40);

    if (sizeBefore !== null) {
      expect(
        await sizeField.inputValue(),
        'widening an area text box must not scale its type',
      ).toBe(sizeBefore);
    }
  });
});
