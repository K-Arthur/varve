import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

async function layerOrder(page: import('@playwright/test').Page): Promise<string[]> {
  return page
    .getByRole('treeitem')
    .evaluateAll((items) =>
      items
        .map((item) => item.getAttribute('data-node-id'))
        .filter((id): id is string => Boolean(id)),
    );
}

function layerRow(page: Page, text: string | RegExp): Locator {
  return page.getByRole('treeitem').filter({ hasText: text }).first();
}

/**
 * The app can perform one final boot navigation after DOMContentLoaded. Keep
 * this workflow independent from that startup race without weakening its
 * assertions about the editor itself.
 */
async function navigateToStableEditor(page: Page): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await navigateToEditor(page);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await page.waitForTimeout(250);
    }
  }
  throw lastError;
}

/** Drop a layer into a frame using the same real pointer path as the Layers UI. */
async function dropLayerIntoFrame(page: Page, layer: Locator, frame: Locator): Promise<void> {
  await layer.scrollIntoViewIfNeeded();
  const sourceBox = await layer.boundingBox();
  if (!sourceBox) throw new Error('Source layer must be visible before reparenting');

  const sourceX = sourceBox.x + 8;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX, sourceY - 12);
  await frame.scrollIntoViewIfNeeded();
  const targetBox = await frame.boundingBox();
  if (!targetBox) throw new Error('Target frame must be visible before reparenting');
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height / 2;
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(
      sourceX + ((targetX - sourceX) * step) / 6,
      sourceY - 12 + ((targetY - (sourceY - 12)) * step) / 6,
    );
  }
  // dnd-kit calculates the destination from the pointer's current position.
  // Let it paint the "drop into frame" target before releasing the pointer.
  await page.waitForTimeout(120);
  await expect(frame.locator('xpath=..')).toHaveClass(/layers-row--drop-into/);
  await page.mouse.up();
}

test.describe('Alignment and arrangement workflow', () => {
  test.describe.configure({ mode: 'serial' });

  test('aligns through the inspector and moves a multi-selection as a stable layer block', async ({
    page,
  }, testInfo) => {
    await navigateToStableEditor(page);
    await seedLayers(page, 4);

    const layers = page.getByRole('treeitem');
    await layers.nth(0).click();
    await layers.nth(1).click({ modifiers: ['Control'] });
    await layers.nth(2).click({ modifiers: ['Control'] });
    await layers.nth(3).click({ modifiers: ['Control'] });
    await expect(page.locator('.insp-panel__multi-count')).toContainText('4');

    const canvas = page.getByTestId('editor-canvas');
    await canvas.screenshot({ path: 'test-results/alignment-arrangement-before.png' });
    await testInfo.attach('alignment-before', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    const alignLeft = page.getByRole('button', { name: 'Align left edges' });
    await expect(alignLeft).toBeEnabled();
    await alignLeft.click();
    await page.waitForTimeout(750);
    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await page.waitForTimeout(500);
    await canvas.screenshot({ path: 'test-results/alignment-arrangement-after.png' });
    await testInfo.attach('alignment-after', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    const before = await layerOrder(page);
    expect(before).toHaveLength(4);
    const selectedIds = [before[1]!, before[2]!];
    await page.locator(`[data-node-id="${selectedIds[0]}"]`).click();
    await page.locator(`[data-node-id="${selectedIds[1]}"]`).click({ modifiers: ['Control'] });
    await page.getByRole('menuitem', { name: 'Arrange' }).click();
    await page.getByRole('menuitem', { name: 'Bring Forward' }).click();

    await expect.poll(() => layerOrder(page)).not.toEqual(before);
    expect((await layerOrder(page)).filter((id) => selectedIds.includes(id))).toEqual(selectedIds);
    await page.screenshot({ path: 'test-results/alignment-arrangement-z-order.png' });
    await testInfo.attach('arrangement-after', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('aligns an imported image with a sibling inside a frame without reparenting either layer', async ({
    page,
  }, testInfo) => {
    await navigateToStableEditor(page);
    const canvas = page.getByTestId('editor-canvas');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Canvas must be visible before creating a frame');

    await page.keyboard.press('f');
    await page.mouse.move(canvasBox.x + 180, canvasBox.y + 160);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 480, canvasBox.y + 440);
    await page.mouse.up();
    await page.keyboard.press('Escape');
    const frame = layerRow(page, /^Frame/);
    await expect(frame).toBeVisible();
    await frame.click();
    await expect(page.getByRole('heading', { name: 'Align & distribute' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Align to page' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Align left edges' })).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.keyboard.press('r');
    await page.mouse.move(canvasBox.x + 250, canvasBox.y + 230);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 340, canvasBox.y + 320);
    await page.mouse.up();
    await page.keyboard.press('Escape');
    const rectangle = layerRow(page, /^Rectangle/);
    await expect(rectangle).toHaveAttribute('aria-level', '2');

    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    const image = layerRow(page, /test-image/i);
    await expect(image).toBeVisible({ timeout: 15000 });
    await dropLayerIntoFrame(page, image, frame);
    await expect(image).toHaveAttribute('aria-level', '2');

    await image.click();
    await expect(page.getByRole('heading', { name: 'Align & distribute' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Align left edges' })).toBeDisabled();
    const alignToPage = page.getByRole('button', { name: 'Align to page' });
    await alignToPage.click();
    await expect(page.getByRole('button', { name: 'Align left edges' })).toBeEnabled();
    await page.getByRole('button', { name: 'Align to page (active)' }).click();
    await expect(page.getByRole('button', { name: 'Align left edges' })).toBeDisabled();

    await rectangle.click({ modifiers: ['Control'] });
    await expect(page.locator('.insp-panel__multi-count')).toContainText('2');
    await page.getByRole('button', { name: 'Align left edges' }).click();
    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await page.waitForTimeout(750);

    // Alignment changes only local transforms. Both visual layers must stay
    // frame children rather than being lifted into the document root.
    await expect(image).toHaveAttribute('aria-level', '2');
    await expect(rectangle).toHaveAttribute('aria-level', '2');
    await expect(canvas).toHaveScreenshot('nested-image-frame-alignment.png', {
      maxDiffPixels: 7000,
    });
    await page.screenshot({ path: 'test-results/nested-image-frame-alignment.png' });
    await testInfo.attach('nested-image-frame-alignment', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
