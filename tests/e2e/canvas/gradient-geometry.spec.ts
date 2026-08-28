/** Real-browser regression for affine canvas-gradient handle editing. */

import { expect, type Page, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

async function createSelectedRect(page: Page): Promise<void> {
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('editor canvas has no layout box');
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 350, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 300, box.y + 250);
}

async function handlePosition(page: Page, selector: string): Promise<[number, number]> {
  return page
    .locator(selector)
    .evaluate((element) => [
      Number(element.getAttribute('cx')),
      Number(element.getAttribute('cy')),
    ]) as Promise<[number, number]>;
}

test.describe('canvas gradient geometry', () => {
  test('a handle drag materializes geometry and undo/redo it as one transaction', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);
    await createSelectedRect(page);

    await page
      .getByRole('button', { name: /add fill/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Linear gradient' }).click();
    const endpoint = page.locator(
      '[data-gradient-handle="linear-end"][data-gradient-fill-index="1"]',
    );
    await expect(endpoint).toBeVisible();
    const before = await handlePosition(
      page,
      '[data-gradient-handle="linear-end"][data-gradient-fill-index="1"]',
    );
    const endpointBox = await endpoint.boundingBox();
    if (!endpointBox) throw new Error('linear gradient endpoint has no layout box');

    await page.mouse.move(
      endpointBox.x + endpointBox.width / 2,
      endpointBox.y + endpointBox.height / 2,
    );
    await page.mouse.down();
    await expect(page.locator('[data-gradient-handle-overlay]')).toHaveAttribute(
      'data-gradient-dragging',
      'true',
    );
    await page.mouse.move(
      endpointBox.x + endpointBox.width / 2 + 72,
      endpointBox.y + endpointBox.height / 2 + 28,
      {
        steps: 6,
      },
    );
    await page.mouse.up();

    await expect
      .poll(() =>
        handlePosition(page, '[data-gradient-handle="linear-end"][data-gradient-fill-index="1"]'),
      )
      .not.toEqual(before);
    const edited = await handlePosition(
      page,
      '[data-gradient-handle="linear-end"][data-gradient-fill-index="1"]',
    );

    await page.keyboard.press('Control+z');
    await expect
      .poll(() =>
        handlePosition(page, '[data-gradient-handle="linear-end"][data-gradient-fill-index="1"]'),
      )
      .toEqual(before);

    await page.keyboard.press('Control+Shift+z');
    await expect
      .poll(() =>
        handlePosition(page, '[data-gradient-handle="linear-end"][data-gradient-fill-index="1"]'),
      )
      .toEqual(edited);
  });
});
