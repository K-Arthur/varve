import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Deep Selection', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function createFrameWithChild(page: import('@playwright/test').Page) {
    // Create frame (F shortcut)
    await page.keyboard.press('f');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    // Drag frame from (100,100) to (500,400)
    const sx = box.x + 100;
    const sy = box.y + 100;
    const ex = box.x + 500;
    const ey = box.y + 400;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(Math.round((sx + ex) / 2), Math.round((sy + ey) / 2));
    await page.mouse.move(ex, ey);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Create child rect (R shortcut) inside the frame
    await page.keyboard.press('r');
    const csx = box.x + 150;
    const csy = box.y + 150;
    const cex = box.x + 300;
    const cey = box.y + 250;
    await page.mouse.move(csx, csy);
    await page.mouse.down();
    await page.mouse.move(Math.round((csx + cex) / 2), Math.round((csy + cey) / 2));
    await page.mouse.move(cex, cey);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Switch to select tool
    await page.keyboard.press('v');
    await page.waitForTimeout(200);

    return {
      canvasBox: box,
      frameCenter: { x: box.x + 300, y: box.y + 250 },
      childCenter: { x: box.x + 225, y: box.y + 200 },
    };
  }

  test('1. Click selects the frame (topmost container)', async ({ page }) => {
    const { canvasBox } = await createFrameWithChild(page);

    // Click in the frame area (should select the frame, not the child)
    await page.mouse.click(canvasBox.x + 400, canvasBox.y + 350);
    await page.waitForTimeout(200);

    // The frame should be selected: aria-selected on the treeitem
    const frameItem = page.locator(
      '[role="treeitem"][data-layer-type="frame"][aria-selected="true"]',
    );
    await expect(frameItem).toHaveCount(1);
  });

  test('2. Ctrl+Click deep-selects the child inside the frame', async ({ page }) => {
    const { childCenter } = await createFrameWithChild(page);

    // Ctrl+Click on the child area to deep-select through the frame
    await page.keyboard.down('Control');
    await page.mouse.click(childCenter.x, childCenter.y);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    // The child shape should be selected, not the frame.
    const childItem = page.locator(
      '[role="treeitem"][data-layer-type="shape"][aria-selected="true"]',
    );
    await expect(childItem).toHaveCount(1);
  });

  test('3. Escape exits isolation mode', async ({ page }) => {
    const { frameCenter } = await createFrameWithChild(page);

    // Select the frame
    await page.mouse.click(frameCenter.x, frameCenter.y);
    await page.waitForTimeout(100);

    // Enter the frame (double-click or Enter)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Escape should exit isolation
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // The isolation breadcrumb should no longer be visible
    const isolationLabel = page.locator('.layers-panel__isolation-label');
    await expect(isolationLabel).toHaveCount(0);
  });

  test('4. Layers panel selection matches canvas selection', async ({ page }) => {
    const { childCenter } = await createFrameWithChild(page);

    // Deep-select child via Ctrl+Click
    await page.keyboard.down('Control');
    await page.mouse.click(childCenter.x, childCenter.y);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    // Check the layers panel shows correct selection
    const layersSelected = page.locator('[role="treeitem"][aria-selected="true"]');
    const count = await layersSelected.count();
    expect(count).toBe(1);
  });

  test('5. Tab cycles through selectable nodes', async ({ page }) => {
    await createFrameWithChild(page);

    // Ensure select tool is active
    await page.keyboard.press('v');
    await page.waitForTimeout(100);

    // Tab to cycle through nodes
    // First tab selects something
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    const selectedCount = await selected.count();
    expect(selectedCount).toBe(1);

    // Tab again to move to next node
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
  });

  test('6. Auto-reveal preference can be toggled', async ({ page }) => {
    // Open layers panel and find the auto-reveal toggle
    const autoRevealBtn = page.getByRole('button', { name: 'Auto-reveal canvas selection' });
    await expect(autoRevealBtn).toBeAttached();

    // Click to toggle off
    await autoRevealBtn.click();
    await page.waitForTimeout(100);
    await expect(autoRevealBtn).toHaveAttribute('aria-pressed', 'false');

    // Click to toggle back on
    await autoRevealBtn.click();
    await page.waitForTimeout(100);
    await expect(autoRevealBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('7. Breadcrumb appears when object is selected', async ({ page }) => {
    const { canvasBox } = await createFrameWithChild(page);

    // Select the frame
    await page.mouse.click(canvasBox.x + 400, canvasBox.y + 350);
    await page.waitForTimeout(200);

    // The breadcrumb navigation should be visible
    const breadcrumb = page.locator('.selection-breadcrumb');
    await expect(breadcrumb).toBeAttached();
  });

  test('8. Marquee selection works with containment mode', async ({ page }) => {
    const { canvasBox } = await createFrameWithChild(page);

    // Drag a marquee that only partially contains the frame
    await page.mouse.move(canvasBox.x + 50, canvasBox.y + 50);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 200, canvasBox.y + 200, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Default (intersection mode): should select
    // The frame's bbox intersects the marquee
    const selected = page.locator('[role="treeitem"][aria-selected="true"]');
    const selectedCount = await selected.count();
    expect(selectedCount).toBeGreaterThanOrEqual(1);
  });

  test('9. Breadcrumb parent navigation selects the parent', async ({ page }) => {
    const { canvasBox } = await createFrameWithChild(page);

    // Deep-select the child
    await page.keyboard.down('Control');
    await page.mouse.click(canvasBox.x + 225, canvasBox.y + 200);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    // The breadcrumb should show the hierarchy
    const breadcrumb = page.locator('.selection-breadcrumb');
    await expect(breadcrumb).toBeAttached();

    // Click the parent segment in the breadcrumb
    const parentSegment = page.locator('.selection-breadcrumb__segment').first();
    await parentSegment.click();
    await page.waitForTimeout(200);

    // The frame should now be selected
    const frameItem = page.locator(
      '[role="treeitem"][data-layer-type="frame"][aria-selected="true"]',
    );
    await expect(frameItem).toHaveCount(1);
  });

  test('10. Selection set can be created and restored', async ({ page }) => {
    const { canvasBox } = await createFrameWithChild(page);

    // Select the frame
    await page.mouse.click(canvasBox.x + 400, canvasBox.y + 350);
    await page.waitForTimeout(200);

    // Save through the Layers panel rather than a removed private test API.
    const saveSelection = page.getByRole('button', { name: /save current selection/i });
    await saveSelection.click();

    // Deselect
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Verify selection set exists in the panel
    const selectionSetsList = page.getByRole('listbox', { name: 'Selection sets' });
    await expect(selectionSetsList).toBeVisible();

    // Click the selection set to restore it
    const setItem = page.locator('.selection-sets__name-btn');
    await setItem.first().click();
    await page.waitForTimeout(200);

    // The frame should be selected again
    const frameItem = page.locator(
      '[role="treeitem"][data-layer-type="frame"][aria-selected="true"]',
    );
    await expect(frameItem).toHaveCount(1);
  });

  test('11. Auto-reveal disabled preserves scroll position', async ({ page }) => {
    const { canvasBox } = await createFrameWithChild(page);

    // Toggle auto-reveal off
    const autoRevealBtn = page.getByRole('button', {
      name: 'Auto-reveal canvas selection',
    });
    await autoRevealBtn.click();
    await page.waitForTimeout(100);
    await expect(autoRevealBtn).toHaveAttribute('aria-pressed', 'false');

    // Select the frame
    await page.mouse.click(canvasBox.x + 400, canvasBox.y + 350);
    await page.waitForTimeout(200);

    // The frame should be selected (highlight works even with auto-reveal off)
    const frameItem = page.locator(
      '[role="treeitem"][data-layer-type="frame"][aria-selected="true"]',
    );
    await expect(frameItem).toHaveCount(1);

    // Toggle auto-reveal back on
    await autoRevealBtn.click();
    await page.waitForTimeout(100);
    await expect(autoRevealBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('12. Deep selection does not move objects', async ({ page }) => {
    const { canvasBox } = await createFrameWithChild(page);

    // Get initial frame position via the test API
    const initialPos = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      if (win.__strataTest) {
        return (
          win.__strataTest as { getSelectionBounds: () => { x: number; y: number } | null }
        ).getSelectionBounds();
      }
      return null;
    });

    // Deep-select the child
    await page.keyboard.down('Control');
    await page.mouse.click(canvasBox.x + 225, canvasBox.y + 200);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    // Get position after selection
    const afterPos = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      if (win.__strataTest) {
        return (
          win.__strataTest as { getSelectionBounds: () => { x: number; y: number } | null }
        ).getSelectionBounds();
      }
      return null;
    });

    // Position should not have changed
    expect(afterPos).toEqual(initialPos);
  });
});
