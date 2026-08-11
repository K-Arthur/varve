import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Canvas drawing tools — drag-to-create', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Rectangle tool creates a rect node on drag', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/rect/i);
  });

  test('Ellipse tool creates an ellipse node on drag', async ({ page }) => {
    await page.keyboard.press('o');
    await dragOnCanvas(page, 150, 150, 350, 300);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/ellipse/i);
  });

  test('Frame tool creates a frame node on drag', async ({ page }) => {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 150, 150, 500, 450);

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/frame/i);
  });

  test('drag-created rect is visibly painted on the content canvas (not just in the doc)', async ({
    page,
  }) => {
    // Regression guard for the rootChildren/activePage.contentRoot page-scoping
    // bug class: a node can exist in doc.nodes (and thus in the Layers panel)
    // while never being painted, because the canvas renderer walks
    // activePageNodes(doc), not doc.nodes directly.
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await contentCanvas.screenshot();

    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    // Let the (possibly async-engine-backed) draw pass settle.
    await page.waitForTimeout(300);

    const after = await contentCanvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('shapes still paint exactly where dragged after panning far (floating-origin regression)', async ({
    page,
  }) => {
    test.setTimeout(120000);
    // Regression guard for the former pseudo-floating-origin implementation:
    // it subtracted a 512-unit camera origin without rebasing scene geometry,
    // so crossing a cell boundary moved pixels away from hit-testing and DOM
    // overlays. A long pan must remain continuous under the canonical camera.
    await page.keyboard.press('h');
    await dragOnCanvas(page, 400, 400, 400 - 900, 400 - 900);

    await page.keyboard.press('r');
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    // Compare only the clipped region we're about to draw into — proves the
    // shape rendered exactly at the drag coordinates, not just "somewhere".
    const clip = { x: 150, y: 150, width: 200, height: 150 };
    // After an extreme pan the canvas element may re-render and briefly have
    // no bounding box. Wait for layout to settle.
    let canvasBox = await contentCanvas.boundingBox();
    for (let i = 0; i < 5 && !canvasBox; i++) {
      await page.waitForTimeout(500);
      canvasBox = await contentCanvas.boundingBox();
    }
    if (!canvasBox) throw new Error('content canvas not found after pan');
    const pageClip = { ...clip, x: canvasBox.x + clip.x, y: canvasBox.y + clip.y };
    const before = await page.screenshot({ clip: pageClip });
    await page.waitForTimeout(500);
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(300);
    const after = await page.screenshot({ clip: pageClip });

    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('Text tool creates a visible text node on click', async ({ page }) => {
    // Text tool creates a text node at the click position on the canvas.
    // The text node is initially empty but should appear in the layers panel.
    await page.keyboard.press('t');
    const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await contentCanvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i);
  });

  test('Create and Release Clipping Mask shortcuts preserve editable child layers', async ({
    page,
  }) => {
    await page.keyboard.press('o');
    await dragOnCanvas(page, 150, 150, 400, 350);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 210, 190, 340, 310);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    await page.getByRole('tree', { name: 'Layers' }).focus();
    await page.keyboard.press('Control+a');
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(2);
    await page.keyboard.press('Control+7');

    await expect(page.getByRole('treeitem').first()).toContainText(/rectangle.*clip/i, {
      timeout: 10000,
    });
    await expect(page.getByRole('treeitem')).toHaveCount(3);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.dblclick(box.x + 270, box.y + 240);
    await expect(page.getByText(/isolating: rectangle.*clip/i)).toBeVisible();
    await expect(page.getByRole('img', { name: 'Clipping mask source' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText(/isolating:/i)).toHaveCount(0);

    await page.keyboard.press('Control+Alt+7');

    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    await expect(page.getByRole('treeitem').filter({ hasText: /rect/i })).toHaveCount(1);
    await expect(page.getByRole('treeitem').filter({ hasText: /ellipse/i })).toHaveCount(1);
  });

  test('dropping an image onto a closed shape intentionally creates a clipping mask', async ({
    page,
  }) => {
    await page.keyboard.press('o');
    await dragOnCanvas(page, 180, 160, 420, 360);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.evaluate(
      ({ clientX, clientY }) => {
        const base64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l5fNwAAAAABJRU5ErkJggg==';
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
        const target = document.querySelector('canvas.editor-canvas__content-layer');
        if (!target) throw new Error('content canvas not found');
        target.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            dataTransfer: transfer,
          }),
        );
        target.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            dataTransfer: transfer,
          }),
        );
      },
      { clientX: box.x + 300, clientY: box.y + 260 },
    );

    await expect(page.getByRole('treeitem').first()).toContainText(/ellipse.*clip/i, {
      timeout: 15000,
    });
    await expect(page.getByRole('img', { name: 'Clipping mask source' })).toHaveText('mask');
    await expect(page.getByRole('img', { name: 'Clipped content' })).toHaveText('clipped');
  });
});
