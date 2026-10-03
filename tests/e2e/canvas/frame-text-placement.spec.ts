import { expect, type Page, test } from '@playwright/test';
import { screenToWorld, worldToScreen } from '@varve/shared';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function readCanvasView(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const parent = canvas?.parentElement;
    const perf = (
      window as unknown as {
        __varvePerf?: {
          forceFullRedraw(): Promise<unknown>;
          getLast(): {
            camera?: { zoom: number; panX: number; panY: number; rotation: number };
          } | null;
        };
      }
    ).__varvePerf;
    if (!canvas || !parent || !perf)
      throw new Error('Text placement needs the mounted perf canvas');
    await perf.forceFullRedraw();
    const camera = perf.getLast()?.camera;
    if (!camera) throw new Error('Text placement has no committed camera');
    const rect = canvas.getBoundingClientRect();
    return {
      camera: {
        zoom: camera.zoom,
        pan: { x: camera.panX, y: camera.panY },
        rotation: camera.rotation,
      },
      viewport: { width: parent.clientWidth, height: parent.clientHeight },
      left: rect.left,
      top: rect.top,
    };
  });
}

async function expectEditorAtWorldPoint(page: Page, world: readonly [number, number]) {
  const editor = page.getByRole('textbox', { name: /editing text/i });
  await expect(editor).toBeFocused();
  // Selection adds a breadcrumb row and the camera preserves its world centre.
  // Compare against the current authoritative view instead of the old absolute
  // pointer position, while keeping the original world position fixed.
  await expect
    .poll(async () => {
      const view = await readCanvasView(page);
      const screen = worldToScreen(view.camera, world[0], world[1], view.viewport);
      const box = await editor.boundingBox();
      if (!box) throw new Error('text editor not found');
      return Math.max(
        Math.abs(box.x - (view.left + screen[0])),
        Math.abs(box.y - (view.top + screen[1])),
      );
    })
    .toBeLessThanOrEqual(1);
  return editor;
}

test.describe('Frame and text placement', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, '/?perf=1');
  });

  test('drag-created area text preserves its box and editor position', async ({ page }) => {
    await page.keyboard.press('t');
    const view = await readCanvasView(page);
    const world = screenToWorld(view.camera, 160, 60, view.viewport);
    const canvasBox = await dragOnCanvas(page, 160, 60, 380, 180);
    expect(Math.abs(canvasBox.x - view.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(canvasBox.y - view.top)).toBeLessThanOrEqual(1);

    const editor = await expectEditorAtWorldPoint(page, world);
    const editorBox = await editor.boundingBox();
    if (!editorBox) throw new Error('text editor not found');
    expect(Math.abs(editorBox.width - 220)).toBeLessThanOrEqual(1);
    expect(editorBox.height).toBeGreaterThanOrEqual(120);

    await editor.fill('A deliberately long line of text that must wrap inside its fixed text box.');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('treeitem').filter({ hasText: /text/i })).toHaveCount(1);
    // The status bar uses the multiplication sign (and some browser fonts
    // expose it as a plain x), not the old prose "by" label.
    await expect(page.locator('.selection-info-bar__dimensions')).toHaveText(/220\s*[×x]\s*120/);
  });

  test('text placed in a translated frame remains under the pointer', async ({ page }) => {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 120, 100, 520, 420);
    await expect(page.getByRole('treeitem').filter({ hasText: /frame/i })).toHaveCount(1);

    await page.keyboard.press('t');
    const view = await readCanvasView(page);
    const world = screenToWorld(view.camera, 240, 210, view.viewport);
    await page.mouse.click(view.left + 240, view.top + 210);
    const editor = await expectEditorAtWorldPoint(page, world);
    await editor.fill('Inside frame');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('treeitem').filter({ hasText: /text/i })).toHaveCount(1);
  });
});
