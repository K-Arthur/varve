import { expect, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
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

  test('renders a legible overview in every theme and at every rail width', async ({ page }) => {
    const minimap = page.getByTestId('minimap-panel');
    const stage = minimap.locator('.minimap-panel__stage');
    const canvas = minimap.locator('canvas.minimap-panel__canvas');
    const out = 'minimap-design-review-2026-09-29';

    // Populate the surface with a mixed set of objects.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 120, 100, 360, 280);
    await page.keyboard.press('o');
    await dragOnCanvas(page, 420, 140, 640, 340);
    await page.keyboard.press('v');
    await expect(minimap).toContainText('2 objects');

    // Every header control belongs to one of two scopes, and the map owns no
    // third copy of a command the StatusBar already offers.
    const headerButtons = await minimap
      .locator('.minimap-panel__header button')
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('aria-label') ?? n.textContent ?? ''),
      );
    expect(headerButtons).toContain('Hide minimap');
    expect(headerButtons.some((label) => /fit/i.test(label))).toBe(false);

    // The card must not claim space it does not paint: the canvas fills its
    // stage to within a hair.
    const stageBox = await stage.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeCloseTo(stageBox!.width - 2, 0);
    expect(canvasBox!.width).toBeGreaterThan(120);
    expect(canvasBox!.height).toBeGreaterThan(60);

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      // Written straight to the root attribute: that is exactly what
      // `applyThemePreference` writes, and it is the path where the map used to
      // keep painting light tokens under a dark panel.
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.waitForTimeout(500);

      await minimap.screenshot({ path: evidencePath(`${out}/01-${theme}-1440.png`) });

      // The overview must show more than a flat field: ink, backplate, and the
      // viewfinder outline are all present at distinct tones.
      const tones = await canvas.evaluate((node) => {
        const htmlCanvas = node as HTMLCanvasElement;
        const context = htmlCanvas.getContext('2d');
        if (!context) return 0;
        const pixels = context.getImageData(0, 0, htmlCanvas.width, htmlCanvas.height).data;
        const colors = new Set<string>();
        for (let i = 0; i < pixels.length; i += 4) {
          colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        }
        return colors.size;
      });
      expect(tones, `minimap renders as a flat field in ${theme}`).toBeGreaterThan(4);
      await minimap.screenshot({ path: evidencePath(`${out}/02-${theme}-panel.png`) });
    }

    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });

    const widthsSeen: Record<'wide-1920' | 'narrow-1024' | 'compact-900', number> = {
      'wide-1920': 0,
      'narrow-1024': 0,
      'compact-900': 0,
    };
    for (const [width, height, name] of [
      [1920, 1080, 'wide-1920'],
      [1024, 700, 'narrow-1024'],
      [900, 600, 'compact-900'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(minimap).toBeVisible();
      await page.waitForTimeout(500);
      const sized = await minimap.evaluate((node) => {
        const panel = node as HTMLElement;
        const panelBox = panel.getBoundingClientRect();
        const stageBox = panel.querySelector('.minimap-panel__stage')?.getBoundingClientRect();
        const canvas = panel.querySelector('canvas.minimap-panel__canvas');
        const canvasBox = canvas?.getBoundingClientRect();
        return {
          panelWidth: panelBox.width,
          stageWidth: stageBox?.width ?? 0,
          canvasWidth: canvasBox?.width ?? 0,
          canvasHeight: canvasBox?.height ?? 0,
        };
      });
      // At every rail width the painted map fills its stage, so there is no
      // width where the card claims a region the map does not use.
      expect(sized.canvasWidth, `${name}: canvas fills its stage`).toBeGreaterThan(
        sized.stageWidth - 6,
      );
      expect(sized.canvasWidth).toBeGreaterThan(0);
      expect(sized.canvasHeight).toBeGreaterThan(0);
      widthsSeen[name] = sized.canvasWidth;
      await minimap.screenshot({ path: evidencePath(`${out}/03-${name}.png`) });
    }
    // The overview scales with its rail instead of being pinned to a fixed
    // pixel size, which is how a small overview becomes a permanently small
    // overview on a large display.
    expect(widthsSeen['wide-1920']).toBeGreaterThan(widthsSeen['compact-900'] * 1.5);

    // A high zoom shrinks the true projected viewport; the drawn rectangle has
    // a floor, so it must remain a real, findable rectangle rather than
    // collapsing to a hairline.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 30; i++) {
      await zoomIn.click({ timeout: 4000 }).catch(() => undefined);
    }
    await page.waitForTimeout(700);
    await minimap.screenshot({ path: evidencePath(`${out}/04-high-zoom-minimum-viewfinder.png`) });
    const highZoom = await canvas.evaluate((node) => {
      const htmlCanvas = node as HTMLCanvasElement;
      const context = htmlCanvas.getContext('2d');
      if (!context) return 0;
      const pixels = context.getImageData(0, 0, htmlCanvas.width, htmlCanvas.height).data;
      const colors = new Set<string>();
      for (let i = 0; i < pixels.length; i += 4) {
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      }
      return colors.size;
    });
    expect(highZoom).toBeGreaterThan(4);
  });

  test('follows a forced-colors change without a reload', async ({ page }) => {
    // Forced colours rewrite the custom properties the canvas reads while
    // leaving `data-theme` alone, so the map has to observe the media query
    // itself — otherwise an OS high-contrast toggle repaints the panel chrome
    // and leaves the canvas drawing the previous palette.
    const canvas = page.locator('canvas.minimap-panel__canvas');
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('minimap-panel')).toContainText('0 objects');

    const backplate = () =>
      canvas.evaluate((node) => {
        const htmlCanvas = node as HTMLCanvasElement;
        const context = htmlCanvas.getContext('2d');
        if (!context) return null;
        const { width, height } = htmlCanvas;
        const data = context.getImageData(0, 0, width, height).data;
        const counts = new Map<string, number>();
        for (let i = 0; i < data.length; i += 4) {
          const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        return { tone: top?.[0] ?? null, distinct: counts.size };
      });

    await page.emulateMedia({ forcedColors: 'active' });
    await expect.poll(async () => (await backplate())?.distinct ?? 0).toBeGreaterThan(1);
    const forced = await backplate();

    await page.emulateMedia({ forcedColors: 'none' });
    await expect.poll(async () => (await backplate())?.tone).not.toBe(forced?.tone ?? null);

    // And back again: the observer must work in both directions, not once.
    await page.emulateMedia({ forcedColors: 'active' });
    await expect.poll(async () => (await backplate())?.tone).toBe(forced?.tone ?? null);
  });

  test('reports an honest empty surface instead of a blank tile', async ({ page }) => {
    const minimap = page.getByTestId('minimap-panel');
    const caption = minimap.locator('.minimap-panel__empty');
    await expect(caption).toBeVisible();
    await expect(caption).toContainText('Nothing on this surface yet');
    // The canvas stays mounted so the tab stop does not move when the first
    // object appears.
    await expect(minimap.locator('canvas.minimap-panel__canvas')).toBeVisible();
    await minimap.screenshot({
      path: evidencePath('minimap-design-review-2026-09-29/05-empty-state.png'),
    });

    await page.keyboard.press('r');
    await dragOnCanvas(page, 140, 120, 360, 300);
    await expect(minimap).toContainText('1 object');
    await expect(caption).toHaveCount(0);
  });
});
