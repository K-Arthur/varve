import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function selectedCanvasBounds(page: import('@playwright/test').Page) {
  const topLeft = page.getByLabel('Top-left resize handle');
  const bottomRight = page.getByLabel('Bottom-right resize handle');
  await expect(topLeft).toBeAttached();
  await expect(bottomRight).toBeAttached();
  const [tl, br] = await Promise.all([topLeft.boundingBox(), bottomRight.boundingBox()]);
  if (!tl || !br) throw new Error('selection handles not measurable');
  return {
    left: tl.x + tl.width / 2,
    top: tl.y + tl.height / 2,
    right: br.x + br.width / 2,
    bottom: br.y + br.height / 2,
    center: {
      x: (tl.x + tl.width / 2 + br.x + br.width / 2) / 2,
      y: (tl.y + tl.height / 2 + br.y + br.height / 2) / 2,
    },
  };
}

test('selected child drag keeps the child target and artwork synchronized', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  const frameStart = { x: box.x + 100, y: box.y + 100 };
  const frameEnd = { x: box.x + 500, y: box.y + 400 };
  await page.keyboard.press('f');
  await page.mouse.move(frameStart.x, frameStart.y);
  await page.mouse.down();
  await page.mouse.move(frameEnd.x, frameEnd.y, { steps: 8 });
  await page.mouse.up();

  const frameItem = page.locator(
    '[role="treeitem"][data-layer-type="frame"][aria-selected="true"]',
  );
  await expect(frameItem).toHaveCount(1);
  const frameBounds = await selectedCanvasBounds(page);

  // The editor may reveal the newly-created frame after the pointer gesture,
  // so the camera can settle between the initial canvas measurement and this
  // interaction. Use the rendered selection bounds rather than stale canvas
  // offsets; this still drives the real canvas pointer path.
  const childStart = { x: frameBounds.left + 80, y: frameBounds.top + 60 };
  const childEnd = { x: frameBounds.left + 200, y: frameBounds.top + 150 };
  await page.keyboard.press('r');
  await page.mouse.move(childStart.x, childStart.y);
  await page.mouse.down();
  await page.mouse.move(childEnd.x, childEnd.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('v');

  const childBounds = await selectedCanvasBounds(page);
  // Establish the container hit first, then deep-select the child at its
  // actual rendered center. This avoids coupling the test to camera/page
  // placement while retaining the Ctrl+Click behavior under test.
  await page.mouse.click(frameBounds.left + 300, frameBounds.top + 220);
  await expect(frameItem).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.down('Control');
  await page.mouse.click(childBounds.center.x, childBounds.center.y);
  await page.keyboard.up('Control');
  await expect(
    page.locator('[role="treeitem"][data-layer-type="shape"][aria-selected="true"]'),
  ).toHaveCount(1);

  const reportDir = path.resolve('reports/selection-integrity');
  await fs.mkdir(reportDir, { recursive: true });
  const capture = async (name: string) => {
    const png = await canvas.screenshot({ path: path.join(reportDir, `${name}.png`) });
    await testInfo.attach(name, { body: png, contentType: 'image/png' });
  };

  await capture('selected-child-before-drag');
  const beforeSelection = await page
    .locator('[role="treeitem"][aria-selected="true"]')
    .allTextContents();

  await page.mouse.move(childBounds.center.x, childBounds.center.y);
  await page.mouse.down();
  await page.mouse.move(childBounds.center.x + 25, childBounds.center.y + 15, { steps: 4 });
  await capture('selected-child-during-drag');
  await page.mouse.move(childBounds.center.x + 70, childBounds.center.y + 50, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await capture('selected-child-after-drag');

  const selected = page.locator('[role="treeitem"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute('data-layer-type', 'shape');
  expect(beforeSelection).toHaveLength(1);

  const lockButton = page.getByRole('button', { name: /Lock Rectangle 1/i });
  await expect(lockButton).toBeVisible();
  await lockButton.click();
  await capture('selected-child-locked');
  await expect(page.locator('[aria-label="Top-left resize handle"]')).toHaveCount(0);

  await page.mouse.move(childBounds.center.x + 70, childBounds.center.y + 50);
  await page.mouse.down();
  await page.mouse.move(childBounds.center.x + 120, childBounds.center.y + 90, { steps: 4 });
  await page.mouse.up();
  await capture('selected-child-locked-after-attempt');
  await expect(selected).toHaveCount(1);
});
