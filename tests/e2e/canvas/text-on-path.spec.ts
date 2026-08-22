import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

/**
 * Text on path, end to end through the real editor.
 *
 * The engine has placed glyphs along a shape for a long time, but no editor
 * surface ever set `textMode: 'path'`, so the capability was unreachable.
 * These cover the route a user now takes: draw a shape, add text, attach.
 */

async function canvasBox(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 20000 });
  const box = await canvas.boundingBox();
  if (!box || box.width < 10) throw new Error('content canvas not laid out');
  return box;
}

async function dragOn(
  page: import('@playwright/test').Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** Ellipse tool, then the text tool — the two nodes the attach needs. */
async function drawRingAndLabel(page: import('@playwright/test').Page) {
  await page.keyboard.press('o');
  await dragOn(page, 200, 150, 520, 470);
  await page.keyboard.press('t');
  await dragOn(page, 620, 200, 900, 250);
  await page.keyboard.type('VELO CLUB', { delay: 20 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('v');
}

test.describe('text on path', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('the Object menu offers Text on Path once a text layer and a shape are selected', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await drawRingAndLabel(page);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    await page.getByRole('menuitem', { name: /^Object$/ }).click();
    const item = page.getByRole('menuitem', { name: /^Text on Path$/ });
    await expect(item).toBeVisible({ timeout: 5000 });
    await expect(item).toBeEnabled();
  });

  test('attaching reveals the Text on Path inspector section', async ({ page }) => {
    test.setTimeout(120000);
    await drawRingAndLabel(page);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    await page.getByRole('menuitem', { name: /^Object$/ }).click();
    await page.getByRole('menuitem', { name: /^Text on Path$/ }).click();
    await page.waitForTimeout(600);

    // The section only renders for a single text node already in path mode,
    // so its presence is evidence the document actually changed.
    await page.getByRole('treeitem').filter({ hasText: /VELO CLUB/i }).first().click();
    await expect(page.getByRole('slider', { name: /start offset along path/i })).toBeVisible({
      timeout: 8000,
    });
  });

  test('the attached text redraws when the start offset moves', async ({ page }) => {
    test.setTimeout(120000);
    await drawRingAndLabel(page);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: /^Object$/ }).click();
    await page.getByRole('menuitem', { name: /^Text on Path$/ }).click();
    await page.waitForTimeout(600);
    await page.getByRole('treeitem').filter({ hasText: /VELO CLUB/i }).first().click();

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await canvas.screenshot();
    const offset = page.getByRole('slider', { name: /start offset along path/i });
    await offset.fill('35');
    await page.waitForTimeout(700);

    expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  });

  test('detaching removes the section and keeps the path', async ({ page }) => {
    test.setTimeout(120000);
    await drawRingAndLabel(page);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: /^Object$/ }).click();
    await page.getByRole('menuitem', { name: /^Text on Path$/ }).click();
    await page.waitForTimeout(600);
    await page.getByRole('treeitem').filter({ hasText: /VELO CLUB/i }).first().click();
    await expect(page.getByRole('slider', { name: /start offset along path/i })).toBeVisible();

    await page.getByRole('button', { name: /detach from path/i }).click();
    await page.waitForTimeout(600);

    await expect(page.getByRole('slider', { name: /start offset along path/i })).toHaveCount(0);
    // The shape is an independent node and must survive the detach.
    await expect(page.getByRole('treeitem')).toHaveCount(2);
  });
});
