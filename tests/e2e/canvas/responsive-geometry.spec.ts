import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

interface ScreenGeometry {
  canvas: { x: number; y: number; width: number; height: number };
  selection: { x: number; y: number; width: number; height: number };
}

async function editorMethod(page: Page, method: string, ...args: unknown[]) {
  return page.evaluate(
    ({ method, args }) => {
      const root = document.getElementById('root');
      if (!root) throw new Error('React root not found');
      const key = Object.keys(root).find(
        (name) => name.startsWith('__reactContainer$') || name.startsWith('__reactFiber$'),
      );
      if (!key) throw new Error('React fiber not found');
      function find(fiber: any): any {
        if (!fiber) return null;
        const value = fiber.memoizedProps?.value;
        if (typeof value?.serializeDocument === 'function') return value;
        return find(fiber.child) || find(fiber.sibling);
      }
      const editor = find((root as any)[key]);
      if (!editor || typeof editor[method] !== 'function') {
        throw new Error(`Missing editor method: ${method}`);
      }
      return editor[method](...args);
    },
    { method, args },
  );
}

async function screenGeometry(page: Page): Promise<ScreenGeometry> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const selection = page.locator('svg:has(filter#selection-glow) > rect').first();
  await expect(selection).toBeVisible();
  return {
    canvas: await canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
    selection: await selection.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  };
}

function centre(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

test.describe('responsive canvas geometry', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
  });

  test('resizing the usable canvas preserves the camera anchor and document', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300000);
    await seedLayers(page, 1);
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(250);

    const beforeDocument = await editorMethod(page, 'serializeDocument');
    const before = await screenGeometry(page);
    const beforeCanvasCentre = centre(before.canvas);
    const beforeSelectionCentre = centre(before.selection);
    expect(Math.abs(beforeSelectionCentre.x - beforeCanvasCentre.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(beforeSelectionCentre.y - beforeCanvasCentre.y)).toBeLessThanOrEqual(3);

    await page.setViewportSize({ width: 1160, height: 760 });
    await expect
      .poll(async () => (await screenGeometry(page)).canvas.width, { timeout: 10000 })
      .toBeLessThan(before.canvas.width - 40);
    await page.waitForTimeout(150);

    const after = await screenGeometry(page);
    const afterCanvasCentre = centre(after.canvas);
    const afterSelectionCentre = centre(after.selection);
    expect(Math.abs(afterSelectionCentre.x - afterCanvasCentre.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(afterSelectionCentre.y - afterCanvasCentre.y)).toBeLessThanOrEqual(3);
    expect(await editorMethod(page, 'serializeDocument')).toBe(beforeDocument);

    await page.screenshot({
      path: testInfo.outputPath('responsive-resize.png'),
      fullPage: false,
    });
  });

  test('wheel zoom refreshes moved canvas geometry before client-to-world conversion', async ({
    page,
  }) => {
    test.setTimeout(300000);
    await seedLayers(page, 1);
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(250);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.evaluate(() => {
      const surface = document.querySelector('.editor-canvas');
      if (!surface) throw new Error('editor canvas surface not found');
      surface.setAttribute('data-test-geometry-shift', 'true');
      (surface as HTMLElement).style.transform = 'translate(44px, 22px)';
    });
    await expect
      .poll(async () => (await screenGeometry(page)).canvas.x, { timeout: 10000 })
      .toBeGreaterThan(40);

    const moved = await screenGeometry(page);
    const anchor = centre(moved.selection);
    await canvas.evaluate((element, point) => {
      element.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          ctrlKey: true,
          deltaY: -12,
        }),
      );
    }, anchor);
    await page.waitForTimeout(180);

    const afterZoom = await screenGeometry(page);
    const afterAnchor = centre(afterZoom.selection);
    expect(Math.abs(afterAnchor.x - anchor.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(afterAnchor.y - anchor.y)).toBeLessThanOrEqual(4);
  });
});
