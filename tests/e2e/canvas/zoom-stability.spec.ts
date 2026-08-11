import { expect, type Locator, type Page, test } from '@playwright/test';
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

async function expectSelectionPainted(canvas: Locator, selection: SelectionRect): Promise<void> {
  const samples = await canvas.evaluate((element, box) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    const scaleX = surface.width / surface.clientWidth;
    const scaleY = surface.height / surface.clientHeight;
    const background = context.getImageData(0, 0, 1, 1).data;
    return [0.25, 0.5, 0.75].map((fraction) => {
      const pixel = context.getImageData(
        Math.max(
          0,
          Math.min(surface.width - 1, Math.round((box.x + box.width * fraction) * scaleX)),
        ),
        Math.max(0, Math.min(surface.height - 1, Math.round((box.y + box.height / 2) * scaleY))),
        1,
        1,
      ).data;
      const backgroundDifference = Array.from(pixel).reduce(
        (difference, channel, index) => difference + Math.abs(channel - (background[index] ?? 0)),
        0,
      );
      const chroma =
        Math.max(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0) -
        Math.min(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0);
      return Math.max(backgroundDifference, chroma);
    });
  }, selection);
  for (const sample of samples) expect(sample).toBeGreaterThan(12);
}

test.describe('Zoom camera stability', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('fit-selection and subsequent zooms keep the selected object centered and painted', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page.keyboard.press('r');
    await dragOnCanvas(page, 60, 45, 80, 65);
    // The auto-namer may label a small square rect "Icon placeholder"
    // instead of "Rectangle N" — match either so creation is verified.
    await expect(
      page.getByRole('treeitem').filter({ hasText: /rectangle|icon placeholder/i }),
    ).toHaveCount(1);
    const beforeMove = await selectionRect(page);

    // Moving a leaf takes the renderer's partial-redraw path. A leaked clip
    // from that path previously made the next camera-only redraw appear blank.
    await page.keyboard.press('v');
    await page.mouse.move(canvasBox.x + 70, canvasBox.y + 55);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 85, canvasBox.y + 70);
    await page.mouse.up();
    const afterMove = await selectionRect(page);
    expect(afterMove.x - beforeMove.x).toBeGreaterThan(10);
    expect(afterMove.y - beforeMove.y).toBeGreaterThan(10);

    await canvas.focus();
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(350);

    const fitted = await selectionRect(page);
    expect(fitted.x + fitted.width / 2).toBeCloseTo(canvasBox.width / 2, 0);
    expect(fitted.y + fitted.height / 2).toBeCloseTo(canvasBox.height / 2, 0);
    await expectSelectionPainted(canvas, fitted);

    await page.keyboard.press('+');
    await page.waitForTimeout(100);
    const zoomedIn = await selectionRect(page);
    expect(zoomedIn.x + zoomedIn.width / 2).toBeCloseTo(canvasBox.width / 2, 0);
    expect(zoomedIn.y + zoomedIn.height / 2).toBeCloseTo(canvasBox.height / 2, 0);
    await expectSelectionPainted(canvas, zoomedIn);

    await page.keyboard.press('-');
    await page.waitForTimeout(100);
    const zoomedOut = await selectionRect(page);
    expect(zoomedOut.x + zoomedOut.width / 2).toBeCloseTo(canvasBox.width / 2, 0);
    expect(zoomedOut.y + zoomedOut.height / 2).toBeCloseTo(canvasBox.height / 2, 0);
    await expectSelectionPainted(canvas, zoomedOut);
  });

  test('a trackpad wheel burst accumulates every zoom delta around the selected object', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.keyboard.press('r');
    await dragOnCanvas(page, 80, 60, 140, 110);
    await canvas.focus();
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(350);

    const before = await selectionRect(page);
    await canvas.evaluate(
      (element, center) => {
        const bounds = element.getBoundingClientRect();
        for (let index = 0; index < 12; index += 1) {
          element.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              clientX: bounds.left + center.x,
              clientY: bounds.top + center.y,
              ctrlKey: true,
              deltaY: -10,
            }),
          );
        }
      },
      { x: before.x + before.width / 2, y: before.y + before.height / 2 },
    );
    await page.waitForTimeout(150);

    const after = await selectionRect(page);
    expect(after.width).toBeGreaterThan(before.width * 2);
    // The zoom anchor is the measured box centre; its fractional SVG values
    // quantize the anchor by <1px at zoom 1, which the ~3.3x zoomed-out box
    // then shows as up to ~3px. Tolerate that scaled quantization — the
    // invariant is that the anchor does not drift with zoom amount.
    expect(Math.abs(after.x + after.width / 2 - (before.x + before.width / 2))).toBeLessThanOrEqual(
      3,
    );
    expect(
      Math.abs(after.y + after.height / 2 - (before.y + before.height / 2)),
    ).toBeLessThanOrEqual(3);
    await expectSelectionPainted(canvas, after);
  });

  test('zoom keeps an overflowing child painted when its unclipped frame is offscreen', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    // Draw the child first, then draw a frame around it. Frame creation captures
    // fully-contained siblings, exercising the real pointer-driven parenting path.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 140, 140, 200, 200);
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 260, 260);

    const frameRow = page.getByRole('treeitem').filter({ hasText: /frame/i }).first();
    // The child is a small rect; the auto-namer may label it "Icon
    // placeholder" instead of "Rectangle N".
    const childRow = page
      .getByRole('treeitem')
      .filter({ hasText: /rectangle|icon placeholder/i })
      .last();
    await expect(frameRow).toBeVisible();
    await expect(childRow).toBeVisible();
    await expect(childRow).toHaveAttribute('aria-level', '2');

    // Frames clip by default. Disable clipping through the mounted Inspector;
    // this is the state that makes off-frame descendants valid visible content.
    const layoutDisclosure = page.getByRole('button', { name: /^layout$/i });
    if ((await layoutDisclosure.getAttribute('aria-expanded')) !== 'true') {
      await layoutDisclosure.click();
    }
    const clipContent = page.getByRole('checkbox', { name: /^clip content$/i });
    await expect(clipContent).toBeChecked();
    await clipContent.uncheck();
    await expect(clipContent).not.toBeChecked();

    // Move the child far outside the frame in local coordinates, then move the
    // frame itself completely left of the viewport. The overflowing child lands
    // back inside the viewport while its parent's own bounds remain offscreen.
    await childRow.click();
    const childX = page.getByRole('spinbutton', { name: /^x(?: \(ab\))? \(px\)$/i });
    await childX.fill('700');
    await childX.press('Enter');

    await frameRow.click();
    const frameX = page.getByRole('spinbutton', { name: /^x(?: \(ab\))? \(px\)$/i });
    await frameX.fill('-400');
    await frameX.press('Enter');
    await page.waitForTimeout(100);

    const offscreenFrame = await selectionRect(page);
    expect(offscreenFrame.x + offscreenFrame.width).toBeLessThan(0);

    await childRow.click();
    const beforeZoom = await selectionRect(page);
    expect(beforeZoom.x).toBeGreaterThan(0);
    expect(beforeZoom.x + beforeZoom.width).toBeLessThan(canvasBox.width);
    await expectSelectionPainted(canvas, beforeZoom);

    await canvas.focus();
    await page.keyboard.press('+');
    await page.waitForTimeout(150);

    const afterZoom = await selectionRect(page);
    expect(afterZoom.x).toBeGreaterThan(0);
    expect(afterZoom.x + afterZoom.width).toBeLessThan(canvasBox.width);
    await expectSelectionPainted(canvas, afterZoom);
  });
});
