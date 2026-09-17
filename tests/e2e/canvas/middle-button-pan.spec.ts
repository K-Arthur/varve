import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function selectionRect(page: Page): Promise<SelectionRect> {
  const overlay = page.locator('svg:has(filter#selection-glow)');
  const rect = overlay.locator(':scope > rect').first();
  await expect(rect).toBeVisible();
  return rect.evaluate((element) => {
    const selection = element as SVGRectElement;
    return {
      x: selection.x.baseVal.value,
      y: selection.y.baseVal.value,
      width: selection.width.baseVal.value,
      height: selection.height.baseVal.value,
    };
  });
}

test.describe('Middle-button viewport pan', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('pans the canvas under the Select tool without opening a menu or changing the document', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.keyboard.press('r');
    await dragOnCanvas(page, 80, 60, 180, 160);
    await page.keyboard.press('v');
    await canvas.focus();
    const before = await selectionRect(page);
    const nodeCount = await page.getByRole('treeitem').count();

    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas not found');

    // Middle-button drag with Select active: the viewport must follow the
    // pointer (world content moves opposite to the drag), no context menu or
    // browser autoscroll may engage, and the tool must stay Select.
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + 280, box.y + 210, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(300);

    const after = await selectionRect(page);
    // Content follows the pointer 1:1: a left-up drag moves the artwork
    // left/up by the same CSS distance.
    expect(after.x).toBeLessThan(before.x - 100);
    expect(after.y).toBeLessThan(before.y - 70);
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(await page.getByRole('treeitem').count()).toBe(nodeCount);
    // The editor keeps hidden <dialog> elements mounted; assert none became
    // visible (no context menu / autoscroll UI from the middle button).
    await expect(page.locator('dialog:visible')).toHaveCount(0);

    // The Select tool still owns the primary button after the pan: a fresh
    // drag draws nothing new and selection stays a selection (no marquee
    // artefact), and the layer count is unchanged.
    await dragOnCanvas(page, 500, 500, 560, 540);
    expect(await page.getByRole('treeitem').count()).toBe(nodeCount);
  });

  test('momentum continuation stops cleanly and the next gesture works', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.keyboard.press('r');
    await dragOnCanvas(page, 80, 60, 180, 160);
    await page.keyboard.press('v');
    await canvas.focus();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas not found');

    // A flick: release mid-motion. The hand-tool momentum may carry the pan a
    // little further, but must decay — the viewport must settle, and a second
    // middle drag must track it normally (no stuck navigation state).
    await page.mouse.move(box.x + 500, box.y + 400);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + 380, box.y + 320, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(900);

    const settled = await selectionRect(page);
    await page.mouse.move(box.x + 600, box.y + 450);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + 480, box.y + 370, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(300);

    const again = await selectionRect(page);
    expect(again.x).toBeLessThan(settled.x - 80);
    expect(again.y).toBeLessThan(settled.y - 50);
  });
});
