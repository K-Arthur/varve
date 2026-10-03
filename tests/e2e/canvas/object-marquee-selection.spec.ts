import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('canvas object marquee selection', () => {
  test('previews and commits canvas objects independently from pixel marquee selection', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    await seedLayers(page, 3);

    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(3);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas content surface not found');

    // Start in the empty upper-right canvas corner. The lower edge is occupied
    // by the floating toolbar, and a small top-left inset can overlap a seeded
    // object's hit target even when it looks just outside its fill. Drag back
    // across the artwork so the marquee covers every seeded object.
    const start = { x: box.x + box.width - 48, y: box.y + 40 };
    const end = { x: box.x + 40, y: box.y + box.height - 80 };
    await page.keyboard.press('v');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2);
    await page.mouse.move(end.x, end.y);
    await expect
      .poll(async () =>
        page.locator('svg[role="presentation"] rect[stroke-dasharray="3 3"]').count(),
      )
      .toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath('canvas-object-marquee-preview.png'),
      fullPage: false,
    });
    await page.mouse.up();

    await expect
      .poll(async () => page.locator('[role="treeitem"][aria-selected="true"]').count())
      .toBe(3);
    await expect(rows.nth(0)).not.toHaveAttribute('data-selection-preview', 'true');
    await expect(rows.nth(1)).not.toHaveAttribute('data-selection-preview', 'true');
    await expect(rows.nth(2)).not.toHaveAttribute('data-selection-preview', 'true');
    await page.screenshot({
      path: testInfo.outputPath('canvas-object-marquee-committed.png'),
      fullPage: false,
    });

    // A click on empty canvas is release-only: the existing selection remains
    // intact while the button is held and clears only when the click resolves.
    const empty = { x: box.x + box.width - 40, y: box.y + box.height - 80 };
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(3);
    await page.mouse.up();
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0);

    // X is a tool-local force chord: pressing over an object still starts an
    // object marquee instead of entering move mode. Derive the drag start from
    // the selected object's rendered outline instead of fixed canvas offsets;
    // seeded object positions depend on the responsive canvas geometry.
    await rows.first().click();
    const selectedOutline = page
      .locator('svg[role="presentation"] rect[filter="url(#selection-glow)"]')
      .first();
    await expect(selectedOutline).toBeVisible();
    const outlineBox = await selectedOutline.boundingBox();
    if (!outlineBox) throw new Error('selected object outline not found');
    await canvas.focus();
    await page.keyboard.down('x');
    const forcedStart = {
      x: outlineBox.x + outlineBox.width / 2,
      y: outlineBox.y + outlineBox.height / 2,
    };
    const forcedEnd = { x: forcedStart.x + 12, y: forcedStart.y + 12 };
    await page.mouse.move(forcedStart.x, forcedStart.y);
    await page.mouse.down();
    await page.mouse.move((forcedStart.x + forcedEnd.x) / 2, (forcedStart.y + forcedEnd.y) / 2);
    await page.screenshot({
      path: testInfo.outputPath('canvas-object-marquee-forced-preview.png'),
      fullPage: false,
    });
    await page.mouse.move(forcedEnd.x, forcedEnd.y);
    await expect
      .poll(async () =>
        page.locator('svg[role="presentation"] rect[stroke-dasharray="3 3"]').count(),
      )
      .toBeGreaterThan(0);
    await page.mouse.up();
    await page.keyboard.up('x');
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1);
  });
});
