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

/**
 * Draw a rectangle, select it, then focus the canvas so keyboard zoom keys
 * land on the canvas element (the surface that owns navigation keys).
 */
async function drawAndSelect(page: Page): Promise<SelectionRect> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await page.keyboard.press('r');
  await dragOnCanvas(page, 80, 60, 180, 160);
  await page.keyboard.press('v');
  await canvas.focus();
  const before = await selectionRect(page);
  return before;
}

test.describe('Keyboard zoom controls', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('zoom in and out with main-row + and - keys', async ({ page }) => {
    const before = await drawAndSelect(page);

    await page.keyboard.press('+');
    await page.waitForTimeout(150);
    const zoomedIn = await selectionRect(page);
    expect(zoomedIn.width).toBeGreaterThan(before.width * 1.2);

    await page.keyboard.press('-');
    await page.waitForTimeout(150);
    const zoomedOut = await selectionRect(page);
    expect(zoomedOut.width).toBeLessThan(zoomedIn.width);
  });

  test('numpad add and subtract zoom the canvas', async ({ page }) => {
    const before = await drawAndSelect(page);

    await page.keyboard.press('NumpadAdd');
    await page.waitForTimeout(150);
    const zoomedIn = await selectionRect(page);
    expect(zoomedIn.width).toBeGreaterThan(before.width * 1.2);

    await page.keyboard.press('NumpadSubtract');
    await page.waitForTimeout(150);
    const zoomedOut = await selectionRect(page);
    expect(zoomedOut.width).toBeLessThan(zoomedIn.width);
  });

  test('numpad digit presets zoom to the preset level (NumLock on)', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await drawAndSelect(page);

    // Playwright's keyboard.press('Numpad6') synthesizes NumLock-off (key
    // 'ArrowRight'), which is correctly treated as navigation, not a zoom
    // preset. Dispatch a NumLock-on numpad digit (key '6', code 'Numpad6') to
    // exercise the preset path — the 400% preset must grow the selection ~4x.
    await canvas.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: '6',
          code: 'Numpad6',
        }),
      );
    });
    await page.waitForTimeout(150);
    const zoomed = await selectionRect(page);
    expect(zoomed.width).toBeGreaterThan(before.width * 3);
  });

  test('NumLock-off numpad keys navigate instead of zooming', async ({ page }) => {
    const before = await drawAndSelect(page);

    // Numpad6 with NumLock off reads as ArrowRight — the SelectTool's nudge
    // key. It must move the selection, not change zoom.
    await page.keyboard.press('Numpad6');
    await page.waitForTimeout(150);
    const after = await selectionRect(page);
    expect(after.width).toBeCloseTo(before.width, 0);
  });

  test('shift+digit fit shortcuts work regardless of the printed key', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await page.keyboard.press('r');
    await dragOnCanvas(page, 60, 45, 80, 65);
    // Wait for the freshly drawn shape to appear and select it explicitly so
    // fit-selection targets it. The shape may be a rectangle or the default
    // placeholder depending on the active tool state.
    const shapeRow = page.getByRole('treeitem').first();
    await shapeRow.waitFor({ timeout: 5000 });
    await shapeRow.click();
    await page.keyboard.press('v');
    await canvas.focus();

    // Shift+2 = fit selection. On a real US layout Shift+2 prints '@' while
    // Playwright synthesizes key '2'; matching must resolve the physical
    // Digit2 code so both work. The fit animates over ~300ms; poll until the
    // selection settles near the viewport center. Tolerance is generous
    // because the fit viewport excludes the container scrollbar while the
    // assertion uses the full canvas rect — a completely broken shortcut would
    // leave the selection far from center (it started near the artboard
    // origin), so a centered result proves the shortcut fired.
    await page.keyboard.press('Shift+2');
    await expect
      .poll(
        async () => {
          const rect = await selectionRect(page);
          return Math.abs(rect.x + rect.width / 2 - canvasBox.width / 2);
        },
        { timeout: 5000, message: 'fit-selection never centered horizontally' },
      )
      .toBeLessThan(25);
    const fitted = await selectionRect(page);
    expect(Math.abs(fitted.y + fitted.height / 2 - canvasBox.height / 2)).toBeLessThan(25);
  });
});

test.describe('Wheel navigation', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('plain wheel pans the canvas', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.keyboard.press('r');
    await dragOnCanvas(page, 80, 60, 180, 160);
    await canvas.focus();
    const before = await selectionRect(page);

    await canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + 100,
          clientY: bounds.top + 100,
          deltaX: 0,
          deltaY: 80,
        }),
      );
    });
    await page.waitForTimeout(150);

    // Scrolling down (positive deltaY) pans the viewport so content moves up.
    const after = await selectionRect(page);
    expect(after.y).toBeLessThan(before.y);
  });

  test('shift+wheel scrolls horizontally', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.keyboard.press('r');
    await dragOnCanvas(page, 80, 60, 180, 160);
    await canvas.focus();
    const before = await selectionRect(page);

    await canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + 100,
          clientY: bounds.top + 100,
          shiftKey: true,
          deltaX: 0,
          deltaY: 80,
        }),
      );
    });
    await page.waitForTimeout(150);

    const after = await selectionRect(page);
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.x).not.toBeCloseTo(before.x, 0);
  });

  test('ctrl+wheel zooms around the cursor with focal point preserved', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.keyboard.press('r');
    await dragOnCanvas(page, 80, 60, 180, 160);
    await canvas.focus();
    const before = await selectionRect(page);

    // The wheel is dispatched at the selection's center; after zooming in,
    // that world point must stay under the cursor.
    const center = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    await canvas.evaluate((element, anchor) => {
      const bounds = element.getBoundingClientRect();
      for (let i = 0; i < 8; i += 1) {
        element.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: bounds.left + anchor.x,
            clientY: bounds.top + anchor.y,
            ctrlKey: true,
            deltaY: -15,
          }),
        );
      }
    }, center);
    await page.waitForTimeout(200);

    const after = await selectionRect(page);
    expect(after.width).toBeGreaterThan(before.width * 2);
    expect(Math.abs(after.x + after.width / 2 - center.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y + after.height / 2 - center.y)).toBeLessThanOrEqual(1);
  });
});
