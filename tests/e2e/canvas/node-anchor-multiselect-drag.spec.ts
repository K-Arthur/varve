import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

interface Point {
  x: number;
  y: number;
}

async function createEditablePath(page: import('@playwright/test').Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas not found');

  await page.keyboard.press('p');
  // Keep the path well above the node-edit controls, which occupy the lower
  // canvas in a normal editor layout. This avoids testing clicks through UI.
  for (const [x, y] of [
    [0.26, 0.14],
    [0.48, 0.2],
    [0.7, 0.15],
  ] as const) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');

  const layerRow = page.getByRole('treeitem').first();
  if (await layerRow.isVisible().catch(() => false)) await layerRow.click();
  await page.getByRole('button', { name: /edit nodes/i }).click();
  await expect(page.locator('[data-testid="node-edit-overlay"] [data-node-anchor]')).toHaveCount(3);
}

async function nodeAnchors(page: import('@playwright/test').Page): Promise<Point[]> {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('svg[data-testid="node-edit-overlay"]');
    if (!svg) return [];
    return [...svg.querySelectorAll<SVGGElement>('[data-node-anchor]')]
      .sort((a, b) => Number(a.dataset.nodeAnchor ?? 0) - Number(b.dataset.nodeAnchor ?? 0))
      .map((group) => {
        const marker = group.querySelector<SVGRectElement | SVGCircleElement>(
          'rect, circle:not([data-node-handle])',
        );
        if (!marker) return null;
        const bounds = marker.getBoundingClientRect();
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      })
      .filter((point): point is Point => point !== null);
  });
}

test('dragging one selected path anchor moves all selected anchors', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page);
  await createEditablePath(page);

  const anchorsBefore = await nodeAnchors(page);
  expect(anchorsBefore).toHaveLength(3);
  const controls = page.getByTestId('node-edit-controls');
  await expect(controls).toBeVisible();
  const controlsBox = await controls.boundingBox();
  expect(controlsBox).not.toBeNull();

  const anchorTargets = await page.evaluate((points) => {
    const controls = document.querySelector('[data-testid="node-edit-controls"]');
    const bounds = controls?.getBoundingClientRect();
    return points.map(({ x, y }) => ({
      canvas: document.elementFromPoint(x, y)?.matches('canvas.editor-canvas__content-layer'),
      coveredByControls: Boolean(
        bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom,
      ),
    }));
  }, anchorsBefore);
  expect(anchorTargets).toEqual([
    { canvas: true, coveredByControls: false },
    { canvas: true, coveredByControls: false },
    { canvas: true, coveredByControls: false },
  ]);

  await page.mouse.click(anchorsBefore[0]!.x, anchorsBefore[0]!.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(anchorsBefore[1]!.x, anchorsBefore[1]!.y);
  await page.keyboard.up('Shift');
  await expect(
    page.locator('[data-testid="node-edit-overlay"] [data-node-selected="true"]'),
  ).toHaveCount(2);

  await page.mouse.move(anchorsBefore[0]!.x, anchorsBefore[0]!.y);
  await page.mouse.down();
  await page.mouse.move(anchorsBefore[0]!.x + 24, anchorsBefore[0]!.y + 18, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const after = await nodeAnchors(page);
      return (
        after.length === 3 &&
        Math.abs(after[0]!.x - anchorsBefore[0]!.x - 24) < 1 &&
        Math.abs(after[0]!.y - anchorsBefore[0]!.y - 18) < 1 &&
        Math.abs(after[1]!.x - anchorsBefore[1]!.x - 24) < 1 &&
        Math.abs(after[1]!.y - anchorsBefore[1]!.y - 18) < 1 &&
        Math.abs(after[2]!.x - anchorsBefore[2]!.x) < 1 &&
        Math.abs(after[2]!.y - anchorsBefore[2]!.y) < 1
      );
    })
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath('selected-path-anchors-move-together.png'),
  });
});
