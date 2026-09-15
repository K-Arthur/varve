import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function drawRectangle(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  // Re-query the canvas box for every draw: selecting a shape can open the
  // Inspector and reflow the shell, which invalidates a previously captured
  // bounding box.
  const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!box) throw new Error('content canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + width, box.y + y + height, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('v');
}

test.describe('Shape Builder workflow', () => {
  test('selects a swept region set, creates a retained editable result, and undoes it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');

    await drawRectangle(page, 120, 140, 140, 100);
    await drawRectangle(page, 200, 180, 140, 100);
    await expect(page.getByRole('treeitem')).toHaveCount(2);
    await page.screenshot({
      path: testInfo.outputPath('before-shape-builder.png'),
      fullPage: true,
    });

    await canvas.click({ position: { x: 150, y: 170 } });
    await page.keyboard.down('Shift');
    await canvas.click({ position: { x: 280, y: 240 } });
    await page.keyboard.up('Shift');

    const toolbar = page.getByTestId('toolbar');
    await expect(toolbar.getByRole('button', { name: 'Shape Builder', exact: true })).toBeVisible();
    await toolbar.getByRole('button', { name: 'Shape Builder', exact: true }).click();
    await expect(page.getByTestId('shape-builder-controls')).toBeVisible();
    await expect(page.getByTestId('shape-builder-style-policy')).toHaveText(
      'Style: first selected source · Create retains sources',
    );

    // A single pointer sweep crosses the left, overlap, and right faces. The
    // endpoints are deliberately in the outer faces so this catches thin-face
    // skipping and sampled-point-only implementations.
    const sweepBox = await canvas.boundingBox();
    if (!sweepBox) throw new Error('content canvas not found');
    await page.mouse.move(sweepBox.x + 150, sweepBox.y + 205);
    await page.mouse.down();
    await page.mouse.move(sweepBox.x + 320, sweepBox.y + 205, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId('shape-builder-status')).toContainText('3 regions selected');
    await page.screenshot({
      path: testInfo.outputPath('during-shape-builder.png'),
      fullPage: true,
    });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shape-builder-status')).toContainText(
      'Click a filled region or sweep across several regions',
    );
    await expect(page.getByRole('treeitem')).toHaveCount(2);

    await page.mouse.move(sweepBox.x + 150, sweepBox.y + 205);
    await page.mouse.down();
    await page.mouse.move(sweepBox.x + 320, sweepBox.y + 205, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId('shape-builder-status')).toContainText('3 regions selected');

    await page.getByRole('button', { name: 'Create selected regions' }).click();
    await expect(page.getByTestId('shape-builder-controls')).toHaveCount(0);
    await expect(page.getByRole('treeitem')).toHaveCount(3);
    // The committed result must actually be selected, not merely present:
    // the tool clears and re-applies selection after the transaction.
    await expect(
      page.getByRole('treeitem').filter({ hasText: 'Shape Builder result' }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: testInfo.outputPath('after-shape-builder.png'), fullPage: true });

    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem')).toHaveCount(2);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByRole('treeitem')).toHaveCount(3);

    // The result is placed above the retained sources, so double-clicking the
    // committed region enters node editing through the ordinary Select tool.
    // Design does not declare a Node Edit toolbar button; double-click is the
    // workspace-independent entry point documented in help.
    await page.mouse.dblclick(sweepBox.x + 150, sweepBox.y + 205);
    await expect(
      page.locator('svg').filter({ has: page.locator('title', { hasText: 'Node edit overlay' }) }),
    ).toBeVisible();
  });

  test('outlines a stroke-blocked source on request and becomes usable', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');

    await drawRectangle(page, 140, 150, 180, 130);
    await expect(page.getByRole('treeitem')).toHaveCount(1);

    // Give the only source a visible stroke through the real Inspector. The
    // add action lives in the Stroke section header (not inside the collapsed
    // disclosure body).
    await canvas.click({ position: { x: 230, y: 215 } });
    const addStroke = page.getByRole('button', { name: /add stroke/i });
    await addStroke.scrollIntoViewIfNeeded();
    await expect(addStroke).toBeVisible();
    await addStroke.click();

    const toolbar = page.getByTestId('toolbar');
    await toolbar.getByRole('button', { name: 'Shape Builder', exact: true }).click();
    await expect(page.getByTestId('shape-builder-controls')).toBeVisible();
    await expect(page.getByTestId('shape-builder-status')).toContainText(/outline the stroke/i);
    await page.screenshot({
      path: testInfo.outputPath('stroke-blocked.png'),
      fullPage: true,
    });

    // The recovery action must be a real control, not a hint.
    const outlineButton = page.getByTestId('shape-builder-outline-strokes');
    await expect(outlineButton).toBeVisible();
    await outlineButton.click();

    // Moving the pointer refreshes the derived arrangement against the new
    // document; the previously blocked selection is now eligible.
    const sweepBox = await canvas.boundingBox();
    if (!sweepBox) throw new Error('content canvas not found');
    await page.mouse.move(sweepBox.x + 230, sweepBox.y + 215);
    await expect(page.getByTestId('shape-builder-status')).toContainText(
      'Click a filled region or sweep across several regions',
    );
    // Sweep from the empty interior across the outlined stroke band to the
    // outside. The band and the bounded empty interior are both selectable;
    // the empty face is fillable with Create.
    await page.mouse.move(sweepBox.x + 200, sweepBox.y + 215);
    await page.mouse.down();
    await page.mouse.move(sweepBox.x + 110, sweepBox.y + 215, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('shape-builder-status')).toContainText('2 regions selected');
    await page.screenshot({
      path: testInfo.outputPath('stroke-outlined-usable.png'),
      fullPage: true,
    });

    // Create fills the outlined band and its enclosed interior as one new
    // editable result while the outlined source stays in the document.
    await page.getByRole('button', { name: 'Create selected regions' }).click();
    await expect(page.getByTestId('shape-builder-controls')).toHaveCount(0);
    await expect(page.getByRole('treeitem')).toHaveCount(2);
    await expect(
      page.getByRole('treeitem').filter({ hasText: 'Shape Builder result' }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({
      path: testInfo.outputPath('stroke-recovered-result.png'),
      fullPage: true,
    });
  });
});
