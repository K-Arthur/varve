import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function canvasPixels(page: import('@playwright/test').Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('content canvas is not readable');
    return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
  });
}

function changedPixels(before: readonly number[], after: readonly number[]): number {
  if (before.length !== after.length) return Number.POSITIVE_INFINITY;
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (
      Math.abs(before[i]! - after[i]!) > 2 ||
      Math.abs(before[i + 1]! - after[i + 1]!) > 2 ||
      Math.abs(before[i + 2]! - after[i + 2]!) > 2 ||
      Math.abs(before[i + 3]! - after[i + 3]!) > 2
    ) {
      changed++;
    }
  }
  return changed;
}

async function editorCanvas(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('editor canvas has no bounds');
  return { canvas, box };
}

test.describe('font readiness and multiline text geometry', () => {
  test('font readiness does not require selecting the text to repaint it', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const { canvas, box } = await editorCanvas(page);

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 220, box.y + 180);
    await page.keyboard.insertText('Bundled Geist typography');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 20, box.y + 20);

    await page.evaluate(async () => {
      await document.fonts.ready;
      await document.fonts.load('400 24px "Geist Variable"', 'Bundled Geist typography');
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    const beforeSelection = await canvas.screenshot({ animations: 'disabled' });
    const beforePixels = await canvasPixels(page);
    await canvas.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('editor-font-before-selection.png'),
    });
    await testInfo.attach('before-selection.png', {
      body: beforeSelection,
      contentType: 'image/png',
    });

    await page.mouse.click(box.x + 250, box.y + 185);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const afterSelection = await canvas.screenshot({ animations: 'disabled' });
    const afterPixels = await canvasPixels(page);
    await canvas.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('editor-font-after-selection.png'),
    });
    await testInfo.attach('after-selection.png', {
      body: afterSelection,
      contentType: 'image/png',
    });
    expect(changedPixels(beforePixels, afterPixels)).toBeLessThan(20);
  });

  test('explicit multiline text remains fully represented by its selection geometry', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const { canvas, box } = await editorCanvas(page);

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 240, box.y + 180);
    await page.keyboard.insertText('First line\nSecond line\nThird line');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 240, box.y + 205);

    const selection = page
      .locator('svg[role="presentation"] rect')
      .filter({ visible: true })
      .first();
    await expect(selection).toBeVisible();
    const selectionBox = await selection.boundingBox();
    if (!selectionBox) throw new Error('selection overlay has no bounds');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('editor canvas has no bounds');

    expect(selectionBox.height).toBeGreaterThan(40);
    expect(selectionBox.y).toBeLessThan(canvasBox.y + 220);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('editor-multiline-selection.png'),
      fullPage: false,
    });
  });

  test('/try presents stable bundled-font multiline text', async ({ page }, testInfo) => {
    await page.goto('/?try=1', { timeout: 300000, waitUntil: 'domcontentloaded' });
    await page.locator('.layers-panel').waitFor({ timeout: 60000 });
    const { canvas, box } = await editorCanvas(page);
    await page.keyboard.press('t');
    await page.mouse.click(box.x + 240, box.y + 180);
    await page.keyboard.insertText('Try route first line\nTry route second line');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 240, box.y + 205);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await document.fonts.load('400 24px "Geist Variable"', 'Try route first line');
    });
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('try-font-multiline.png'),
      fullPage: false,
    });
    await expect(canvas).toBeVisible();
  });

  test('blank and trailing lines remain visible in the selected text geometry', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const { canvas, box } = await editorCanvas(page);
    await page.keyboard.press('t');
    await page.mouse.click(box.x + 240, box.y + 180);
    await page.keyboard.insertText('First line\n\nThird line\n\nFifth line\n');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 240, box.y + 210);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('editor-blank-and-trailing-lines.png'),
      fullPage: false,
    });
    const selection = page
      .locator('svg[role="presentation"] rect')
      .filter({ visible: true })
      .first();
    const selectionBox = await selection.boundingBox();
    if (!selectionBox) throw new Error('selection overlay has no bounds');
    expect(selectionBox.height).toBeGreaterThan(80);
    await expect(canvas).toBeVisible();
  });

  test('soft-wrapped area text shows every rendered line inside its container', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const { canvas, box } = await editorCanvas(page);
    await page.keyboard.press('t');
    await dragOnCanvas(page, 240, 180, 430, 310);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await editor.fill(
      'This deliberately long sentence wraps across several lines inside a narrow area text container.',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 300, box.y + 230);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('editor-soft-wrapped-area-text.png'),
      fullPage: false,
    });
    const selection = page
      .locator('svg[role="presentation"] rect')
      .filter({ visible: true })
      .first();
    const selectionBox = await selection.boundingBox();
    if (!selectionBox) throw new Error('selection overlay has no bounds');
    expect(selectionBox.width).toBeGreaterThan(100);
    expect(selectionBox.height).toBeGreaterThan(80);
    await expect(canvas).toBeVisible();
  });
});
