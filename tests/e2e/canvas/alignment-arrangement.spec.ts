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

    const distributionOptions = page.getByRole('button', { name: 'Distribution options' });
    await distributionOptions.click();
    await expect(page.getByRole('dialog', { name: 'Distribution options' })).toBeVisible();
    await page.getByLabel('Fixed gap').check();
    await page.getByLabel('Gap (px)').fill('-12');
    await page.getByRole('button', { name: 'Close distribution options' }).last().click();

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
    await page.locator(`[role="treeitem"][data-node-id="${selectedIds[0]}"]`).click();
    await page
      .locator(`[role="treeitem"][data-node-id="${selectedIds[1]}"]`)
      .click({ modifiers: ['Control'] });
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

  test('aligns a frame child to page and parent references without reparenting', async ({
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
    const frameXField = page.getByRole('spinbutton', { name: /^x \(px\)$/i });
    const frameX = Number(await frameXField.inputValue());
    await page.keyboard.press('Escape');

    // Drawing inside the frame uses the supported canvas insertion path and
    // produces a child without introducing a separate Layers DnD dependency
    // into this reference-selection workflow.
    await page.keyboard.press('r');
    await page.mouse.move(canvasBox.x + 250, canvasBox.y + 230);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 340, canvasBox.y + 320);
    await page.mouse.up();
    await page.keyboard.press('Escape');
    const rectangle = layerRow(page, /^Rectangle/);
    await expect(rectangle).toHaveAttribute('aria-level', '2');

    await rectangle.click();
    await expect(page.getByRole('heading', { name: 'Align & distribute' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Align left edges' })).toBeDisabled();
    const alignToFrame = page.getByRole('button', { name: 'Align to parent frame' });
    await expect(alignToFrame).toBeEnabled();
    await alignToFrame.click();
    await expect(page.getByRole('button', { name: 'Align left edges' })).toBeEnabled();
    await page.getByRole('button', { name: 'Align left edges' }).click();

    // A page reference remains explicit for a single child and does not
    // detach it from its frame. The active label is part of the user-visible
    // reference contract, not only internal state.
    const alignToPage = page.getByRole('button', { name: 'Align to page' });
    await alignToPage.click();
    await expect(page.getByRole('button', { name: 'Align left edges' })).toBeEnabled();
    await page.getByRole('button', { name: 'Align left edges' }).click();
    await page.getByRole('button', { name: 'Fit all to viewport' }).click();
    await page.waitForTimeout(750);

    // Alignment changes only the child's transform. It stays a frame child,
    // and the screenshot proves the applied relationship is rendered.
    await expect(rectangle).toHaveAttribute('aria-level', '2');
    const xField = page.getByRole('spinbutton', { name: /^x \(px\)$/i });
    // The inspector reports the child's parent-local X. Page-left is world
    // X=0, so the local value plus the unchanged frame origin must be zero.
    await expect.poll(async () => Number(await xField.inputValue()) + frameX).toBeCloseTo(0, 8);
    await expect(page.getByRole('button', { name: 'Align to page (active)' })).toBeVisible();
    await expect(canvas).toHaveScreenshot('nested-frame-reference-alignment.png', {
      maxDiffPixels: 7000,
    });
    await page.screenshot({ path: 'test-results/nested-frame-reference-alignment.png' });
    await testInfo.attach('nested-frame-reference-alignment', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('previews and cancels a canvas gap drag before committing one undoable edit', async ({
    page,
  }) => {
    await navigateToStableEditor(page);
    await seedLayers(page, 2);

    const layers = page.getByRole('treeitem');
    await layers.nth(0).click();
    await layers.nth(1).click({ modifiers: ['Control'] });

    // The two handles share a hit point for this diagonal fixture. The
    // vertical-gap dot is painted last, so select it and move on its axis.
    const handle = page.locator('.alignment-handle__dot--horizontal').first();
    const label = page.locator('.alignment-handle__label').nth(1);
    await expect(handle).toBeVisible();
    await expect(label).toBeVisible();
    const initialLabel = await label.textContent();
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Gap handle must have a browser hit target');

    const centerX = handleBox.x + handleBox.width / 2;
    const centerY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(centerX, centerY + 40, { steps: 6 });
    await expect.poll(() => label.textContent()).not.toBe(initialLabel);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(label).toHaveText(initialLabel ?? '');

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(centerX, centerY + 40, { steps: 6 });
    await expect.poll(() => label.textContent()).not.toBe(initialLabel);
    await page.mouse.up();
    await expect.poll(() => label.textContent()).not.toBe(initialLabel);

    await page.keyboard.press('Control+z');
    await expect.poll(() => label.textContent()).toBe(initialLabel);
  });

  test('applies explicit Tidy Up columns and row/column gaps from the Inspector', async ({
    page,
  }, testInfo) => {
    await navigateToStableEditor(page);
    await seedLayers(page, 4);

    const layers = page.getByRole('treeitem');
    await layers.nth(0).click();
    await layers.nth(1).click({ modifiers: ['Control'] });
    await layers.nth(2).click({ modifiers: ['Control'] });
    await layers.nth(3).click({ modifiers: ['Control'] });

    const tidyButton = page.getByRole('button', { name: 'Tidy up grid' });
    await expect(tidyButton).toBeEnabled();
    await tidyButton.click();
    const tidyDialog = page.getByRole('dialog', { name: 'Tidy up options' });
    await expect(tidyDialog).toBeVisible();

    const columns = page.getByLabel('Columns');
    await columns.fill('2');
    await columns.press('Enter');
    const columnGap = page.getByLabel('Column gap (px)');
    await columnGap.fill('24');
    await columnGap.press('Enter');
    const rowGap = page.getByLabel('Row gap (px)');
    await rowGap.fill('32');
    await rowGap.press('Enter');
    await page.screenshot({ path: 'test-results/tidy-up-controls.png' });
    await testInfo.attach('tidy-up-controls', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await tidyDialog.getByRole('button', { name: 'Apply Tidy Up' }).click();
    await expect(tidyDialog).toBeHidden();

    const canvas = page.getByTestId('editor-canvas');
    await page.waitForTimeout(500);
    const screenshot = await canvas.screenshot();
    await canvas.screenshot({ path: 'test-results/tidy-up-explicit-spacing.png' });
    await testInfo.attach('tidy-up-explicit-spacing', {
      body: screenshot,
      contentType: 'image/png',
    });
    await expect(page.locator('.insp-panel__multi-count')).toContainText('4');
  });
});
