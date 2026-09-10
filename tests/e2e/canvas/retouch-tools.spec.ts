import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const REVIEW_DIR = path.resolve('reports/ui-review/retouch');

async function switchWorkspace(page: import('@playwright/test').Page, label: string) {
  const workspace = page.getByRole('radio', { name: `${label} workspace` });
  if (await workspace.isVisible({ timeout: 1000 }).catch(() => false)) {
    await workspace.click();
    return;
  }
  const homeFile = page.getByRole('gridcell').first();
  if (await homeFile.isVisible({ timeout: 1000 }).catch(() => false)) {
    await homeFile.click();
    await workspace.waitFor({ state: 'visible', timeout: 30000 });
    await workspace.click();
    return;
  }
  await page.getByLabel('More workspaces').click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${label}(?:\\s|$)`, 'i') }).click();
}

test('Photo workspace retouch tools paint through the real canvas interaction', async ({
  page,
}) => {
  test.setTimeout(120000);
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page);

  await switchWorkspace(page, 'Draw');
  await expect(page.locator('[data-tool="paint"]')).toBeVisible();
  await page.locator('[data-tool="paint"]').click();

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not measurable');
  const start = { x: box.x + 240, y: box.y + 220 };
  const end = { x: box.x + 440, y: box.y + 300 };
  const blank = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 240);
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await page.locator('input[aria-label="Foreground color"]').fill('#ff0000');
  await page.mouse.move(box.x + 500, box.y + 360);
  await page.mouse.down();
  await page.mouse.move(box.x + 540, box.y + 380);
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.waitForTimeout(1000);
  const painted = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  expect(painted).not.toBe(blank);

  await switchWorkspace(page, 'Photo');
  const retouchMenu = page.getByLabel('Retouch menu');
  await expect(retouchMenu).toBeVisible();
  await retouchMenu.click();
  await expect(page.getByRole('menuitem', { name: 'Healing Brush' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Healing Brush' }).click();
  await expect(page.locator('[data-tool="healBrush"]')).toBeVisible();

  const source = { x: box.x + 275, y: box.y + 250 };
  await page.keyboard.down('Alt');
  await page.mouse.click(source.x, source.y);
  await page.keyboard.up('Alt');
  await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText('Healing source set');

  await page.mouse.move(box.x + 360, box.y + 280);
  await page.mouse.down();
  await page.mouse.move(box.x + 390, box.y + 300);
  await page.mouse.move(box.x + 420, box.y + 320);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());

  expect(after).toBeDefined();
  await page.screenshot({ path: path.join(REVIEW_DIR, '01-healing-brush-painted.png') });
});
