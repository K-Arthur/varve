import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Canvas minimap', () => {
  test.setTimeout(420000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of ['strata-editor-settings', 'varve-editor-settings']) {
        localStorage.removeItem(key);
      }
    });
    await navigateToEditor(page);
  });

  test('tracks the live canvas, navigates, survives resize/workspace changes, and is recoverable', async ({
    page,
  }) => {
    const minimap = page.getByTestId('minimap-panel');
    const minimapCanvas = minimap.locator('canvas.minimap-panel__canvas');
    await expect(minimap).toBeVisible();
    await expect(minimapCanvas).toBeVisible();

    await page.keyboard.press('r');
    await dragOnCanvas(page, 120, 100, 360, 280);
    await expect(minimap).toContainText('1 object');

    const initialGeometry = await page.evaluate(() => {
      const owner = document.querySelector('.editor-canvas');
      const mini = document.querySelector('.minimap-panel__canvas') as HTMLCanvasElement | null;
      return {
        owner: owner?.getBoundingClientRect().toJSON(),
        minimap: mini
          ? {
              cssWidth: mini.getBoundingClientRect().width,
              cssHeight: mini.getBoundingClientRect().height,
              backingWidth: mini.width,
              backingHeight: mini.height,
            }
          : null,
      };
    });
    expect(initialGeometry.owner?.width).toBeGreaterThan(0);
    expect(initialGeometry.owner?.height).toBeGreaterThan(0);
    expect(initialGeometry.minimap?.backingWidth).toBeGreaterThan(0);
    expect(initialGeometry.minimap?.backingHeight).toBeGreaterThan(0);

    const miniBox = await minimapCanvas.boundingBox();
    expect(miniBox).not.toBeNull();
    await page.mouse.move(miniBox!.x + miniBox!.width * 0.7, miniBox!.y + miniBox!.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(miniBox!.x + miniBox!.width * 0.45, miniBox!.y + miniBox!.height * 0.4, {
      steps: 5,
    });
    await page.mouse.up();
    await expect(page.getByRole('treeitem')).toHaveCount(1);

    await page.setViewportSize({ width: 1024, height: 700 });
    await expect
      .poll(async () => {
        const geometry = await page.evaluate(() => {
          const owner = document.querySelector('.editor-canvas');
          const mini = document.querySelector('.minimap-panel__canvas') as HTMLCanvasElement | null;
          return {
            ownerWidth: owner?.getBoundingClientRect().width ?? 0,
            ownerHeight: owner?.getBoundingClientRect().height ?? 0,
            backingWidth: mini?.width ?? 0,
            backingHeight: mini?.height ?? 0,
          };
        });
        return geometry;
      })
      .toEqual({
        ownerWidth: expect.any(Number),
        ownerHeight: expect.any(Number),
        backingWidth: expect.any(Number),
        backingHeight: expect.any(Number),
      });
    const resizedOwner = await page.locator('.editor-canvas').boundingBox();
    expect(resizedOwner?.width).toBeGreaterThan(0);
    expect(resizedOwner?.height).toBeGreaterThan(0);

    await page.keyboard.press('Control+Shift+5');
    await expect(page.locator('.editor-shell')).toBeVisible();
    await expect(minimapCanvas).toBeVisible();
    await page.keyboard.press('Control+Shift+1');

    await page.keyboard.press('Control+Shift+M');
    await expect(minimap).toHaveCount(0);
    await page.keyboard.press('Control+Shift+M');
    await expect(page.getByTestId('minimap-panel')).toBeVisible();
    const finalMinimap = page.getByTestId('minimap-panel');
    await finalMinimap.scrollIntoViewIfNeeded();
    const finalMinimapBox = await finalMinimap.boundingBox();
    expect(finalMinimapBox?.height).toBeGreaterThan(40);
    await expect
      .poll(async () =>
        finalMinimap.locator('canvas').evaluate((canvas) => {
          const context = (canvas as HTMLCanvasElement).getContext('2d');
          if (!context) return 0;
          const htmlCanvas = canvas as HTMLCanvasElement;
          const pixels = context.getImageData(0, 0, htmlCanvas.width, htmlCanvas.height).data;
          const colors = new Set<string>();
          for (let index = 0; index < pixels.length; index += 4) {
            colors.add(
              `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`,
            );
          }
          return colors.size;
        }),
      )
      .toBeGreaterThan(2);

    await finalMinimap.screenshot({ path: '/tmp/varve-minimap-visual.png' });
  });
});
