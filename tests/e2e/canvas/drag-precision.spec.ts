/**
 * Drag precision + auto-pan E2E.
 *
 * Covers the batched multi-node move path (one document update per sample)
 * and the edge auto-pan invariant: while the camera moves under a held
 * pointer, the dragged object must keep following the pointer (no jump, no
 * drift) — the object/world delta must stay locked to the input.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function selectionRect(page: import('@playwright/test').Page): Promise<SelectionRect> {
  const overlay = page.locator('svg:has(filter#selection-glow)');
  const rect = overlay.locator('rect').first();
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

/** Create a rect via the r-tool drag, then return to the select tool. */
async function createRect(
  page: import('@playwright/test').Page,
  canvasBox: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
) {
  await page.keyboard.press('r');
  await page.mouse.move(canvasBox.x + x, canvasBox.y + y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + x + w / 2, canvasBox.y + y + h / 2);
  await page.mouse.move(canvasBox.x + x + w, canvasBox.y + y + h);
  await page.mouse.up();
  await page.keyboard.press('v');
}

test.describe('drag precision', () => {
  test('multi-select drag moves every node by the exact pointer delta', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 120, 140, 80, 60);
    await createRect(page, canvasBox, 260, 140, 80, 60);
    await expect(page.getByRole('treeitem')).toHaveCount(2);

    // Click rect A, then shift-click rect B to select both.
    await page.mouse.move(canvasBox.x + 160, canvasBox.y + 170);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.down('Shift');
    await page.mouse.move(canvasBox.x + 300, canvasBox.y + 170);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const before = await selectionRect(page);
    // Both rects selected: the union box is wider than either rect alone.
    expect(before.width).toBeGreaterThan(150);

    // Ensure stateRef.current (used by buildToolCtx → canvasToWorld) reflects
    // the committed selection. The SVG overlay reads React state directly, but
    // the tool context reads stateRef which is only updated during render.
    // Without this wait, a race between setState and the next pointer event
    // can cause the drag to see a stale selection.
    await page.waitForTimeout(50);

    // Drag the selection by (60, 40) with Ctrl held to bypass snapping so
    // the final position is pointer-exact. Grab rect A's centre.
    await page.keyboard.down('Control');
    await dragOnCanvas(page, 160, 170, 220, 210);
    await page.keyboard.up('Control');

    const after = await selectionRect(page);
    expect(after.x - before.x).toBeCloseTo(60, 0);
    expect(after.y - before.y).toBeCloseTo(40, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
  });

  test('auto-pan near the canvas edge keeps the dragged object locked to the pointer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 200, 200, 80, 60);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // The camera reference: the minimap's viewport indicator. When the main
    // camera pans, the indicator moves, so the minimap canvas content shifts.
    // Color-agnostic (the accent differs per theme): compare sampled pixels.
    const minimapSignature = async () => {
      const minimap = page.locator('canvas.minimap-panel__canvas');
      await minimap.waitFor({ state: 'attached', timeout: 5000 });
      return minimap.evaluate((element) => {
        const surface = element as HTMLCanvasElement;
        const ctx = surface.getContext('2d');
        if (!ctx) return '';
        const img = ctx.getImageData(0, 0, surface.width, surface.height).data;
        const out: number[] = [];
        for (let i = 0; i < img.length; i += 8) out.push(img[i] ?? 0);
        return out.join(',');
      });
    };
    const diffCount = (a: string, b: string) => {
      const aa = a.split(',');
      const bb = b.split(',');
      let n = 0;
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        if (aa[i] !== bb[i]) n++;
      }
      return n;
    };

    const signatureBefore = await minimapSignature();

    // Drag the rect down near the canvas bottom edge (inside the 40px
    // auto-pan zone) and hold the pointer still. The rect spans screen
    // (200,200)-(280,260); grab its centre (240,230) so the drag is a move.
    const startX = canvasBox.x + 240;
    const startY = canvasBox.y + 230;
    const edgeY = canvasBox.y + canvasBox.height - 12;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 240, edgeY, { steps: 6 });
    await page.waitForTimeout(900);

    // Camera moved: the minimap signature (viewport indicator + content)
    // changed measurably while the pointer was held still.
    const signatureDuring = await minimapSignature();
    expect(diffCount(signatureBefore, signatureDuring)).toBeGreaterThan(20);

    // The dragged object stayed locked under the held pointer: its selection
    // box centre matches the pointer's screen position within a few px (the
    // per-tick camera staleness residual; pre-fix this drifted 15-20px).
    const during = await selectionRect(page);
    expect(Math.abs(during.y + during.height / 2 - (edgeY - canvasBox.y))).toBeLessThanOrEqual(6);

    await page.mouse.up();
    await page.waitForTimeout(150);
    const after = await selectionRect(page);
    // Release settles the drag where it was held; the object does not jump.
    expect(after.y + after.height / 2).toBeCloseTo(during.y + during.height / 2, 0);
  });
});
