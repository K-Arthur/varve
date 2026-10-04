import { expect, test } from '@playwright/test';
import { readEditorState } from '../helpers/tabletControls';
import { navigateToEditor } from '../shared';

interface SerializedNode {
  kind?: string;
  name?: string;
  locked?: boolean;
  visible?: boolean;
}

async function touchDrag(
  page: import('@playwright/test').Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 6,
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...from, id: 1 }],
    });
    for (let step = 1; step <= steps; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / steps,
            y: from.y + ((to.y - from.y) * step) / steps,
            id: 1,
          },
        ],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function chooseTool(
  page: import('@playwright/test').Page,
  id: string,
  label: string,
): Promise<void> {
  const toolbar = page.getByTestId('toolbar');
  const direct = toolbar.locator(`[data-tool="${id}"]`);
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
    return;
  }
  await toolbar.getByRole('button', { name: 'More tools' }).click();
  // Responsive overflow groups tools into category submenus. The visible
  // label in that menu is the registry label (Paint Brush), not the
  // shortcut-oriented label (Paint) used by this test.
  const category = id === 'paint' ? 'Drawing' : 'Raster';
  const menuLabel = id === 'paint' ? 'Paint Brush' : label;
  const categoryItem = page.getByRole('menuitem', { name: category, exact: true });
  await categoryItem.hover();
  await expect(categoryItem).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('menuitem', { name: new RegExp(`^${menuLabel}$`, 'i') }).click();
}

async function ensureLayersDrawerOpen(page: import('@playwright/test').Page) {
  const panel = page.locator('#editor-layers-panel');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('.editor__fab--layers').click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

async function readCanvasPixel(
  page: import('@playwright/test').Page,
  point: { x: number; y: number },
) {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element, screenPoint) => {
    const canvas = element as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(
        canvas.width - 1,
        Math.floor(((screenPoint.x - rect.left) * canvas.width) / rect.width),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        canvas.height - 1,
        Math.floor(((screenPoint.y - rect.top) * canvas.height) / rect.height),
      ),
    );
    const pixel = canvas.getContext('2d')?.getImageData(x, y, 1, 1).data;
    if (!pixel) throw new Error('content canvas pixel unavailable');
    return [...pixel];
  }, point);
}

test('an unselected brush fallback does not paint outside a bounded raster layer', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('content canvas has no bounds');

  // Create a small vector object, then use the real clipped-paint workflow to
  // make a bounded raster layer with a live-alpha parent mask.
  await page.keyboard.press('r');
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 300, canvasBox.y + 250, { steps: 6 });
  await page.mouse.up();

  const contour = page.getByRole('treeitem', { name: /^Rectangle 1, Vector rectangle$/ });
  await expect(contour).toBeVisible();
  await contour.click();
  const paintTool = page.locator('[data-testid="toolbar"] [data-tool="paint"]');
  if (await paintTool.isVisible().catch(() => false)) {
    await paintTool.click();
  } else {
    await page.getByRole('button', { name: /More tools|Overflow/i }).click();
    await page.getByRole('menuitemradio', { name: /^Paint$/i }).click();
  }

  const optionsButton = page.getByRole('button', { name: 'Tool options' });
  if ((await optionsButton.getAttribute('aria-expanded')) !== 'true') await optionsButton.click();
  const options = page.locator('.tool-options__popover');
  await options.getByRole('button', { name: 'Create clipped paint layer' }).click();
  await expect(page.getByRole('treeitem').filter({ hasText: 'Shading' })).toBeVisible();

  // Clear the explicit selection. The next brush stroke should resolve by its
  // actual pointer location, not silently reuse this small raster elsewhere.
  const selectTool = page.locator('[data-testid="toolbar"] [data-tool="select"]');
  await selectTool.click();
  await expect(selectTool).toHaveAttribute('aria-pressed', 'true');
  await canvas.focus();
  await page.keyboard.press('Control+Shift+A');
  await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0);
  await paintTool.click();
  // Brush options reopen on tool changes in a React effect. Wait for that
  // state transition before closing; an immediate attribute read can observe
  // the pre-effect closed state and let the dialog cover the pointer target.
  await expect(optionsButton).toHaveAttribute('aria-expanded', 'true');
  await optionsButton.click();
  await expect(options).toBeHidden();

  const outside = { x: canvasBox.x + 475, y: canvasBox.y + 210 };
  const before = await readCanvasPixel(page, outside);
  const layerCountBefore = await page.getByRole('treeitem').count();
  await page.mouse.move(outside.x - 30, outside.y);
  await page.mouse.down();
  await page.mouse.move(outside.x + 30, outside.y, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByRole('treeitem')).toHaveCount(layerCountBefore + 1, { timeout: 10_000 });
  await expect.poll(() => readCanvasPixel(page, outside), { timeout: 10_000 }).not.toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('brush-painted-outside-bounded-layer.png') });
});

test.describe('tablet touch brush target', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 520 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('strata-clean-shutdown', 'true');
        localStorage.removeItem('varve:crash-loop');
        localStorage.setItem(
          'varve-editor-settings',
          JSON.stringify({ appearance: { layoutPreference: 'tablet' } }),
        );
      } catch {
        // The editor's in-memory tablet defaults still apply.
      }
    });
  });

  test('touch painting outside a clipped layer creates an editable target with visible pixels', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const initialCanvas = await canvas.boundingBox();
    if (!initialCanvas) throw new Error('tablet content canvas has no bounds');

    // Prepare the clipped raster and drawer using the ordinary desktop input
    // path. The regression under test is only the final brush stroke's touch
    // routing, so setup must not depend on touch-click synthesis after a drag.
    await chooseTool(page, 'rect', 'Rectangle');
    const shapeStart = {
      x: initialCanvas.x + initialCanvas.width * 0.12,
      y: initialCanvas.y + initialCanvas.height * 0.2,
    };
    const shapeEnd = {
      x: initialCanvas.x + initialCanvas.width * 0.43,
      y: initialCanvas.y + initialCanvas.height * 0.72,
    };
    await page.mouse.move(shapeStart.x, shapeStart.y);
    await page.mouse.down();
    await page.mouse.move(shapeEnd.x, shapeEnd.y, { steps: 8 });
    await page.mouse.up();
    const layersPanel = await ensureLayersDrawerOpen(page);
    const rectangle = page.getByRole('treeitem', { name: /^Rectangle 1, Vector rectangle$/ });
    await expect(rectangle).toBeVisible({ timeout: 15_000 });

    // Select the vector object and create the real clipped-paint target using
    // the tablet Layers drawer and the Paint tool's options surface.
    await rectangle.click();
    await layersPanel.getByRole('button', { name: 'Close Layers panel', exact: true }).click();
    await chooseTool(page, 'paint', 'Paint');
    const optionsButton = page.getByRole('button', { name: 'Tool options' });
    await expect(optionsButton).toHaveAttribute('aria-expanded', 'true');
    const options = page.locator('.tool-options__popover');
    await options.getByRole('button', { name: 'Create clipped paint layer' }).click();
    const setupDocument = JSON.parse((await readEditorState(page)).serialized) as {
      nodes?: Record<string, SerializedNode>;
    };
    expect(
      Object.values(setupDocument.nodes ?? {}).some(
        (node) => node.kind === 'rasterLayer' && node.name === 'Shading',
      ),
    ).toBe(true);

    // Clear the vector selection and close the drawer before painting. The
    // brush must resolve from the touch start point: reusing the bounded
    // Shading raster here would silently discard pixels outside its extent.
    await chooseTool(page, 'select', 'Select');
    await page.keyboard.press('Control+Shift+A');
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0);
    await chooseTool(page, 'paint', 'Paint');
    await expect(optionsButton).toHaveAttribute('aria-expanded', 'true');
    await optionsButton.click();
    await expect(options).toBeHidden();

    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('tablet canvas disappeared after closing Layers');
    const outside = {
      x: canvasBox.x + canvasBox.width * 0.76,
      y: canvasBox.y + canvasBox.height * 0.52,
    };
    // The stroke is clear of the vector bounds and long enough to contain a
    // stable interior pixel sample after compositing.
    const beforePixel = await readCanvasPixel(page, outside);
    const beforeDocument = JSON.parse((await readEditorState(page)).serialized) as {
      nodes?: Record<string, SerializedNode>;
    };
    const beforeRasterIds = new Set(
      Object.entries(beforeDocument.nodes ?? {})
        .filter(([, node]) => node.kind === 'rasterLayer')
        .map(([id]) => id),
    );
    await page.evaluate(() => {
      const target = window as typeof window & { __tabletBrushPointerTypes?: string[] };
      target.__tabletBrushPointerTypes = [];
      window.addEventListener(
        'pointerdown',
        (event) => {
          if ((event.target as Element | null)?.matches('canvas.editor-canvas__content-layer')) {
            target.__tabletBrushPointerTypes?.push(event.pointerType);
          }
        },
        true,
      );
    });
    await touchDrag(
      page,
      { x: outside.x - 32, y: outside.y },
      { x: outside.x + 32, y: outside.y },
      8,
    );
    const pointerTypes = await page.evaluate(
      () =>
        (window as typeof window & { __tabletBrushPointerTypes?: string[] })
          .__tabletBrushPointerTypes,
    );
    expect(pointerTypes).toContain('touch');

    await expect
      .poll(
        async () => {
          const document = JSON.parse((await readEditorState(page)).serialized) as {
            nodes?: Record<string, SerializedNode>;
          };
          return Object.entries(document.nodes ?? {}).filter(
            ([id, node]) => node.kind === 'rasterLayer' && !beforeRasterIds.has(id),
          ).length;
        },
        { timeout: 15_000 },
      )
      .toBe(1);
    await expect
      .poll(() => readCanvasPixel(page, outside), { timeout: 15_000 })
      .not.toEqual(beforePixel);

    const afterDocument = JSON.parse((await readEditorState(page)).serialized) as {
      nodes?: Record<string, SerializedNode>;
    };
    const createdRaster = Object.entries(afterDocument.nodes ?? {}).find(
      ([id, node]) => node.kind === 'rasterLayer' && !beforeRasterIds.has(id),
    );
    expect(createdRaster).toBeDefined();
    expect(createdRaster?.[1].name).toBe('Brush Layer');
    expect(createdRaster?.[1].visible).not.toBe(false);
    expect(createdRaster?.[1].locked).not.toBe(true);

    await page.screenshot({ path: testInfo.outputPath('tablet-touch-brush-outside-bounds.png') });
  });
});
