import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

interface PathGeometry {
  kind: string;
  closed?: boolean;
  points?: Array<{ x: number; y: number }>;
}

async function pathGeometry(page: Page): Promise<PathGeometry> {
  const selected = await page.evaluate(() => {
    const hooks = (
      window as unknown as {
        __varveIsoTest?: {
          getSelectionGeometry: () => Array<{ shape: PathGeometry | null }>;
        };
      }
    ).__varveIsoTest;
    return hooks?.getSelectionGeometry() ?? [];
  });
  const shape = selected[0]?.shape;
  if (shape?.kind !== 'path') throw new Error('A selected path is required');
  return shape;
}

async function selectPencilPath(page: Page) {
  await navigateToEditor(page, '/?isoTest=1');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not laid out');

  await page.keyboard.press('Shift+p');
  const points = Array.from({ length: 36 }, (_, index) => ({
    x: box.x + 100 + index * 7,
    y: box.y + 170 + Math.sin(index / 2) * 30,
  }));
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up();

  const layer = page.getByRole('treeitem').first();
  await expect(layer).toBeVisible();
  await page.keyboard.press('v');
  await layer.click();
  await expect(page.getByTestId('selection-quick-bar')).toBeVisible();
  await expect.poll(async () => (await pathGeometry(page)).points?.length ?? 0).toBeGreaterThan(3);
}

async function selectNearlyStraightPenPath(page: Page) {
  await navigateToEditor(page, '/?isoTest=1');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not laid out');

  await page.keyboard.press('p');
  const anchors: Array<[number, number]> = [
    [100, 180],
    [200, 180.3],
    [300, 179.8],
    [400, 180.2],
  ];
  for (const [x, y] of anchors) {
    await page.mouse.click(box.x + x, box.y + y);
  }
  await page.keyboard.press('Enter');

  const layer = page.getByRole('treeitem').first();
  await expect(layer).toBeVisible();
  await page.keyboard.press('v');
  await layer.click();
  await expect(page.getByTestId('selection-quick-bar')).toBeVisible();
  await expect.poll(async () => (await pathGeometry(page)).points?.length ?? 0).toBe(4);
}

test.describe('Selection quick-bar vector actions', () => {
  test('simplifies and reverses a selected pen path with visible feedback', async ({ page }) => {
    await selectNearlyStraightPenPath(page);
    const bar = page.getByTestId('selection-quick-bar');
    const before = await pathGeometry(page);
    const beforePoints = before.points ?? [];
    expect(beforePoints.length).toBeGreaterThan(3);

    await bar.getByRole('button', { name: 'Simplify', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Path simplified' })).toBeVisible();
    await expect
      .poll(async () => (await pathGeometry(page)).points?.length ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(beforePoints.length);

    const simplifiedPoints = (await pathGeometry(page)).points ?? [];
    await bar.getByRole('button', { name: 'Reverse path', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Path direction reversed' }),
    ).toBeVisible();
    await expect
      .poll(async () => (await pathGeometry(page)).points?.[0]?.x ?? Number.NaN)
      .toBeCloseTo(simplifiedPoints.at(-1)!.x, 3);
    expect((await pathGeometry(page)).points?.[0]?.y).toBeCloseTo(simplifiedPoints.at(-1)!.y, 3);
  });

  test('explains when simplify preserves the path at its current tolerance', async ({ page }) => {
    await selectPencilPath(page);
    const before = (await pathGeometry(page)).points?.length;
    await page
      .getByTestId('selection-quick-bar')
      .getByRole('button', { name: 'Simplify', exact: true })
      .click();

    await expect(
      page.getByRole('status').filter({ hasText: 'already simplified at the current tolerance' }),
    ).toBeVisible();
    expect((await pathGeometry(page)).points?.length).toBe(before);
  });

  test('closes and reopens a path, and enters node-edit mode', async ({ page }) => {
    await selectPencilPath(page);
    const bar = page.getByTestId('selection-quick-bar');

    await expect(bar.getByRole('button', { name: 'Close path', exact: true })).toBeVisible();
    await bar.getByRole('button', { name: 'Close path', exact: true }).click();
    await expect.poll(async () => (await pathGeometry(page)).closed).toBe(true);

    const reopenedBar = page.getByTestId('selection-quick-bar');
    await expect(reopenedBar.getByRole('button', { name: 'Open path', exact: true })).toBeVisible();
    await reopenedBar.getByRole('button', { name: 'Open path', exact: true }).click();
    await expect.poll(async () => (await pathGeometry(page)).closed).toBe(false);

    const editBar = page.getByTestId('selection-quick-bar');
    await editBar.getByRole('button', { name: 'Edit nodes', exact: true }).click();
    await expect(page.getByTestId('node-edit-controls')).toBeVisible();
    await expect(page.getByTestId('selection-quick-bar')).toHaveCount(0);
  });
});
