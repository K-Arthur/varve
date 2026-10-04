import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

type Point = { x: number; y: number };

async function drawOpenPath(page: import('@playwright/test').Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas not found');

  await page.keyboard.press('p');
  const points = [
    [0.26, 0.42],
    [0.48, 0.3],
    [0.7, 0.46],
  ] as const;
  for (const [x, y] of points) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  const layerRow = page.getByRole('treeitem').first();
  if (await layerRow.isVisible().catch(() => false)) {
    await layerRow.click();
  }
  await page.getByRole('button', { name: /edit nodes/i }).click();
  await page.waitForTimeout(500);
}

async function nodeAnchors(page: import('@playwright/test').Page): Promise<Point[]> {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('svg[data-testid="node-edit-overlay"]');
    if (!svg) return [];
    return [...svg.querySelectorAll<SVGGElement>('[data-node-anchor]')]
      .sort((a, b) => Number(a.dataset.nodeAnchor ?? 0) - Number(b.dataset.nodeAnchor ?? 0))
      .map((group) => {
        const anchor = group.querySelector<SVGRectElement | SVGCircleElement>(
          'rect, circle:not([data-node-handle])',
        );
        if (!anchor) return null;
        const rect = anchor.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })
      .filter((point): point is Point => point !== null);
  });
}

/**
 * Independent alignment oracle: inspect the rendered artwork bitmap near
 * each overlay anchor. The test does not reuse the SVG coordinates or the
 * editor's projection helper, so a shared overlay transform error cannot make
 * the interaction and assertion agree accidentally.
 */
async function artworkInkNear(page: import('@playwright/test').Page, points: Point[]) {
  return page.evaluate((targets) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || rect.width <= 0 || rect.height <= 0) return [];
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return targets.map(({ x, y }) => {
      const px = Math.round((x - rect.left) * scaleX);
      const py = Math.round((y - rect.top) * scaleY);
      const radius = Math.max(5, Math.round(8 * Math.min(scaleX, scaleY)));
      const image = ctx.getImageData(
        Math.max(0, px - radius),
        Math.max(0, py - radius),
        Math.min(canvas.width - Math.max(0, px - radius), radius * 2 + 1),
        Math.min(canvas.height - Math.max(0, py - radius), radius * 2 + 1),
      );
      let nonTransparent = 0;
      for (let index = 3; index < image.data.length; index += 4) {
        if (image.data[index]! > 24) nonTransparent += 1;
      }
      return nonTransparent;
    });
  }, points);
}

test.describe('Node editing pointer selection', () => {
  test('path controls stay clear of the floating toolbar in a compact canvas', async ({ page }) => {
    await page.setViewportSize({ width: 753, height: 520 });
    await navigateToEditor(page);
    await drawOpenPath(page);

    const controls = page.getByTestId('node-edit-controls');
    const toolbar = page.locator('.floating-toolbar').first();
    await expect(controls).toBeVisible();
    await expect(toolbar).toBeVisible();

    const [controlsBox, toolbarBox] = await Promise.all([
      controls.boundingBox(),
      toolbar.boundingBox(),
    ]);
    expect(controlsBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    expect(controlsBox!.y + controlsBox!.height).toBeLessThanOrEqual(toolbarBox!.y);

    const launcherBoxes = await page
      .locator('.editor__fab:visible')
      .evaluateAll((launchers) =>
        launchers.map((launcher) => launcher.getBoundingClientRect().toJSON()),
      );
    expect(launcherBoxes.length).toBeGreaterThan(0);
    for (const launcher of launcherBoxes) {
      const separated =
        controlsBox!.x + controlsBox!.width <= launcher.x ||
        launcher.x + launcher.width <= controlsBox!.x ||
        controlsBox!.y + controlsBox!.height <= launcher.y ||
        launcher.y + launcher.height <= controlsBox!.y;
      expect(separated).toBe(true);
    }

    const reverse = controls.getByRole('button', { name: 'Reverse' });
    /* Short canvases keep the whole editor reachable through the panel's own
       scroll area. Exercise the lower operations after scrolling them into
       view instead of accepting a clipped, unclickable footer. */
    await reverse.scrollIntoViewIfNeeded();
    const reverseBox = await reverse.boundingBox();
    expect(reverseBox).not.toBeNull();
    expect(reverseBox!.y).toBeGreaterThanOrEqual(controlsBox!.y);
    expect(reverseBox!.y + reverseBox!.height).toBeLessThanOrEqual(
      controlsBox!.y + controlsBox!.height,
    );
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim(),
        {
          x: reverseBox!.x + reverseBox!.width / 2,
          y: reverseBox!.y + reverseBox!.height / 2,
        },
      ),
    ).toBe('Reverse');

    await reverse.click();
    await expect(page.locator('[data-testid="node-edit-overlay"] [data-node-anchor]')).toHaveCount(
      3,
    );
    await page.screenshot({
      path: test.info().outputPath('node-edit-controls-clear-of-toolbar.png'),
    });
  });

  test('dragging an already-selected anchor moves the selected group', async ({ page }) => {
    await navigateToEditor(page);
    await drawOpenPath(page);

    const before = await nodeAnchors(page);
    expect(before).toHaveLength(3);
    await expect
      .poll(async () => (await artworkInkNear(page, before)).every((count) => count > 0), {
        timeout: 30000,
        message: 'waited for a painted frame aligned with every node anchor',
      })
      .toBe(true);

    // NodeEditTool handles the anchors through real canvas pointer events.
    // A transform hit target at a bounding-box edge must not steal them.
    const pointerTargets = await page.evaluate(
      (points) =>
        points.map(({ x, y }) => {
          const target = document.elementFromPoint(x, y);
          return {
            canvas: target?.matches('canvas.editor-canvas__content-layer'),
            tag: target?.tagName,
            className: typeof target?.className === 'string' ? target.className : null,
            testId: target?.getAttribute('data-testid'),
            pointerEvents: target ? getComputedStyle(target).pointerEvents : null,
            zIndex: target ? getComputedStyle(target).zIndex : null,
          };
        }),
      before,
    );
    expect(pointerTargets, JSON.stringify(pointerTargets)).toEqual([
      expect.objectContaining({ canvas: true }),
      expect.objectContaining({ canvas: true }),
      expect.objectContaining({ canvas: true }),
    ]);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const beforePixels = await canvas.screenshot();
    await page.mouse.click(before[0]!.x, before[0]!.y);
    // Use a real client-coordinate pointer event so selection follows the
    // same canvas input pipeline as a user's pointer, including Shift state.
    await page.keyboard.down('Shift');
    await page.mouse.click(before[1]!.x, before[1]!.y);
    await page.keyboard.up('Shift');
    await expect(
      page.locator('[data-testid="node-edit-overlay"] [data-node-selected="true"]'),
    ).toHaveCount(2);

    await page.mouse.move(before[0]!.x, before[0]!.y);
    await page.mouse.down();
    await page.mouse.move(before[0]!.x + 24, before[0]!.y + 18, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await nodeAnchors(page);
    expect(after).toHaveLength(3);
    expect(after[0]!.x - before[0]!.x).toBeCloseTo(24, 0);
    expect(after[0]!.y - before[0]!.y).toBeCloseTo(18, 0);
    expect(after[1]!.x - before[1]!.x).toBeCloseTo(24, 0);
    expect(after[1]!.y - before[1]!.y).toBeCloseTo(18, 0);
    expect((await artworkInkNear(page, after)).every((count) => count > 0)).toBe(true);
    expect(Buffer.compare(beforePixels, await canvas.screenshot())).not.toBe(0);
    await page.screenshot({ path: test.info().outputPath('node-editing-group-drag.png') });
  });
});
