import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Real comic-lettering scenarios, not fixtures.
 *
 * These specs drive the actual editor: type natural dialogue, wrap it into a
 * balloon, grow the dialogue into a localization-length replacement, switch
 * balloon voices, and capture the canvas/inspector states for human review.
 * Screenshots land in docs/screenshots/comic-lettering/ so the visual record
 * travels with the repository.
 */
const SHOT_DIR = 'docs/screenshots/comic-lettering';

async function selectLayer(page: import('@playwright/test').Page, pattern: RegExp) {
  const item = page.getByRole('treeitem', { name: pattern }).first();
  await expect(item).toBeVisible();
  await item.click();
}

async function startBalloonFromSelectedText(page: import('@playwright/test').Page) {
  const addBalloon = page.getByRole('button', { name: 'Add speech balloon', exact: true });
  await expect(addBalloon).toBeVisible();
  await addBalloon.click();
}

/**
 * Create a text node at a canvas point. The text overlay can still be closing
 * from the previous node, so retry the click before failing.
 */
async function createTextAt(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  text: string,
): Promise<void> {
  const editor = page.getByRole('textbox', { name: /editing text/i });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('t');
    await page.mouse.click(x, y);
    const appeared = await editor
      .waitFor({ state: 'visible', timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      await page.keyboard.insertText(text);
      await page.keyboard.press('Escape');
      await editor.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(120);
      return;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  throw new Error(`text editor did not appear at ${x},${y}`);
}

test.describe('Comic lettering workflow', () => {
  test('turns a real dialogue line into an editable balloon and reviews fit', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    // This is intentionally a natural dialogue line rather than a short
    // fixture: it exercises wrapping, padding, and the real text editor.
    await page.keyboard.press('t');
    await page.mouse.click(box.x + 260, box.y + 190);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.insertText(
      'Wait for me at the station. If the lights go out, take the east stairs and do not look back.',
    );
    await expect(editor).toHaveValue(
      'Wait for me at the station. If the lights go out, take the east stairs and do not look back.',
    );
    await page.keyboard.press('Escape');

    await page.keyboard.press('v');
    const textLayer = page.getByRole('treeitem', { name: /text:/i }).first();
    await expect(textLayer).toBeVisible();
    await textLayer.click();

    const addBalloon = page.getByRole('button', { name: 'Add speech balloon', exact: true });
    await expect(addBalloon).toBeVisible();
    await addBalloon.click();

    // The command selects the new group, then the Layers tree settles on the
    // next editor render. Re-selecting the group mirrors a common lettering
    // pass: create the balloon, then inspect its recipe before adjusting it.
    const balloonLayer = page.getByRole('treeitem', { name: /speech balloon/i }).first();
    await expect(balloonLayer).toBeVisible();
    await balloonLayer.click();

    const balloonSection = page.getByRole('button', { name: /Comic balloon/i });
    await expect(balloonSection).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Balloon fit policy' })).toHaveText(
      'Reflow in balloon',
    );
    await expect(page.getByRole('combobox', { name: 'Balloon line shape' })).toHaveText(
      'Balloon contour',
    );
    const fitStatus = page.locator('[data-callout-fit-status]');
    await expect(fitStatus).toContainText(/dialogue fits|close to|exceeds/i);

    const layers = await page
      .getByRole('treeitem')
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute('aria-label') ?? item.textContent ?? ''),
      );
    expect(layers.some((name) => /balloon/i.test(name))).toBe(true);
    expect(layers.some((name) => /text/i.test(name))).toBe(true);

    await page.getByRole('button', { name: 'Fit balloon to text', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Balloon fit policy' })).toHaveText(
      'Fit balloon to text',
    );
    await expect(fitStatus).toContainText(/dialogue fits|close to|exceeds/i);

    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({
      path: testInfo.outputPath('comic-lettering-balloon-inspector.png'),
      animations: 'disabled',
      fullPage: false,
    });
    await canvas.screenshot({
      path: testInfo.outputPath('comic-lettering-balloon-canvas.png'),
      animations: 'disabled',
    });
    await page.screenshot({
      path: `${SHOT_DIR}/01-speech-balloon-inspector.png`,
      animations: 'disabled',
      fullPage: false,
    });
    await canvas.screenshot({
      path: `${SHOT_DIR}/01-speech-balloon-canvas.png`,
      animations: 'disabled',
    });
  });

  test('expands dialogue to a localization-length replacement and recovers by fitting', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 240, box.y + 180);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('No.');
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

    await page.keyboard.press('v');
    await selectLayer(page, /text:/i);
    await startBalloonFromSelectedText(page);
    await selectLayer(page, /speech balloon/i);

    const fitStatus = page.locator('[data-callout-fit-status]');
    await expect(fitStatus).toContainText(/dialogue fits|close to|exceeds/i);

    // Re-enter the same text node through the selection quick bar and replace
    // the dialogue the way a localization pass would: same node, same style,
    // much longer string.
    await selectLayer(page, /text:/i);
    const editText = page.getByRole('button', { name: 'Edit text', exact: true });
    await expect(editText).toBeVisible();
    await editText.click();
    const reEditor = page.getByRole('textbox', { name: /editing text/i });
    await expect(reEditor).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(
      'Nein, das habe ich überhaupt nicht so gemeint — ich wollte nur sichergehen, dass wir uns verstehen.',
    );
    await page.keyboard.press('Escape');
    await reEditor.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

    await page.keyboard.press('v');
    await selectLayer(page, /speech balloon/i);
    await expect(fitStatus).toContainText(/exceeds/i);
    await expect(page.getByRole('treeitem', { name: /speech balloon/i }).first()).toBeVisible();

    mkdirSync(SHOT_DIR, { recursive: true });
    await canvas.screenshot({
      path: `${SHOT_DIR}/02-localization-overflow.png`,
      animations: 'disabled',
    });

    await page.getByRole('button', { name: 'Fit balloon to text', exact: true }).click();
    await expect(fitStatus).toContainText(/dialogue fits|close to/i);
    await canvas.screenshot({
      path: `${SHOT_DIR}/02-localization-recovered.png`,
      animations: 'disabled',
    });
    await page.screenshot({
      path: `${SHOT_DIR}/02-localization-inspector.png`,
      animations: 'disabled',
      fullPage: false,
    });
  });

  test('switches between thought, caption, and shout voices', async ({ page }) => {
    test.setTimeout(180000);
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 260, box.y + 200);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('Hmm. The east stairs, then.');
    await page.keyboard.press('Escape');

    await page.keyboard.press('v');
    await selectLayer(page, /text:/i);
    await startBalloonFromSelectedText(page);
    await selectLayer(page, /speech balloon/i);

    mkdirSync(SHOT_DIR, { recursive: true });

    // Thought: the tail must become a chain, not a triangle.
    await page.getByRole('combobox', { name: 'Balloon style' }).click();
    await page.getByRole('option', { name: 'Thought' }).click();
    await expect(page.getByRole('treeitem', { name: /thought bubble/i }).first()).toBeVisible();
    const thoughtBubbles = await page.getByRole('treeitem', { name: /thought bubble/i }).count();
    expect(thoughtBubbles).toBeGreaterThanOrEqual(3);
    await canvas.screenshot({
      path: `${SHOT_DIR}/03-thought-balloon.png`,
      animations: 'disabled',
    });

    // Caption: rectangular narration box with rectangle wrapping.
    await page.getByRole('combobox', { name: 'Balloon style' }).click();
    await page.getByRole('option', { name: 'Caption' }).click();
    await expect(page.getByRole('combobox', { name: 'Balloon line shape' })).toHaveText(
      'Rectangle',
    );
    await page.screenshot({
      path: `${SHOT_DIR}/03-caption-inspector.png`,
      animations: 'disabled',
      fullPage: false,
    });

    // Shout: heavy outline, back to the balloon contour.
    await page.getByRole('combobox', { name: 'Balloon style' }).click();
    await page.getByRole('option', { name: 'Shout' }).click();
    await expect(page.getByRole('combobox', { name: 'Balloon line shape' })).toHaveText(
      'Balloon contour',
    );
    await canvas.screenshot({
      path: `${SHOT_DIR}/03-shout-balloon.png`,
      animations: 'disabled',
    });
  });

  test('captures the balloon in dark and high-contrast themes', async ({ page }) => {
    test.setTimeout(240000);
    for (const theme of ['dark', 'high-contrast'] as const) {
      // Seed the persisted preference for the origin, then build a fresh
      // editor so the app applies the palette at startup.
      await page.goto('/');
      await page.evaluate((value) => localStorage.setItem('varve-theme', value), theme);
      await navigateToEditor(page);

      const canvas = page.locator('canvas.editor-canvas__content-layer');
      await canvas.waitFor({ state: 'visible', timeout: 15000 });
      const box = await canvas.boundingBox();
      if (!box) throw new Error('editor canvas has no bounds');

      await page.keyboard.press('t');
      await page.mouse.click(box.x + 250, box.y + 180);
      const editor = page.getByRole('textbox', { name: /editing text/i });
      await expect(editor).toBeFocused();
      await page.keyboard.insertText('Not while the lights are out.');
      await page.keyboard.press('Escape');
      await page.keyboard.press('v');
      await selectLayer(page, /text:/i);
      await startBalloonFromSelectedText(page);
      await selectLayer(page, /speech balloon/i);

      mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({
        path: `${SHOT_DIR}/05-${theme}-inspector.png`,
        animations: 'disabled',
        fullPage: false,
      });
      await canvas.screenshot({
        path: `${SHOT_DIR}/05-${theme}-canvas.png`,
        animations: 'disabled',
      });
    }
  });

  test('letters a four-balloon panel and captures zoom states', async ({ page }) => {
    test.setTimeout(240000);
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    const dialogues = [
      { text: 'We leave at dawn.', x: 150, y: 120 },
      { text: 'No, that is not what I meant at all.', x: 500, y: 120 },
      { text: 'Then take the east stairs and do not look back.', x: 150, y: 300 },
      { text: 'THOOM', x: 520, y: 330 },
    ];
    for (const dialogue of dialogues) {
      await createTextAt(page, box.x + dialogue.x, box.y + dialogue.y, dialogue.text);
    }

    await page.keyboard.press('v');
    const textLayers = page.getByRole('treeitem', { name: /text:/i });
    const count = await textLayers.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < Math.min(4, count); index++) {
      await textLayers.nth(index).click();
      await startBalloonFromSelectedText(page);
    }

    mkdirSync(SHOT_DIR, { recursive: true });
    await canvas.screenshot({
      path: `${SHOT_DIR}/04-lettered-panel-100.png`,
      animations: 'disabled',
    });

    // Zoomed-out page view: balloons must stay legible as masses.
    await page.keyboard.press('Shift+Digit1');
    await page.waitForTimeout(400);
    await canvas.screenshot({
      path: `${SHOT_DIR}/04-lettered-panel-fit.png`,
      animations: 'disabled',
    });
  });
});
