import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function createRulerGuide(page: import('@playwright/test').Page) {
  const ruler = page.locator('.ruler-canvas--top');
  await expect(ruler).toBeVisible();
  const bounds = await ruler.boundingBox();
  if (!bounds) throw new Error('top ruler not found');
  await page.mouse.move(bounds.x + 120, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 160, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.up();
}

async function contentHash(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!data) throw new Error('content canvas is unavailable');
    let hash = 2166136261;
    for (const byte of data) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return `${canvas.width}x${canvas.height}:${hash >>> 0}`;
  });
}

test('two-point perspective assistance stays a draggable view overlay', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await createRulerGuide(page);
  const guideLine = page.locator('.guide-overlay__line').first();
  await expect(page.locator('.guide-overlay__line')).toHaveCount(1);
  const guideX = Number(await guideLine.getAttribute('x1'));
  const canvas = page.locator('.editor-canvas');
  const canvasBounds = await canvas.boundingBox();
  if (!canvasBounds) throw new Error('canvas was not found');

  const before = await contentHash(page);
  await page.mouse.click(canvasBounds.x + guideX, canvasBounds.y + canvasBounds.height / 2, {
    button: 'right',
  });
  const menu = page.getByRole('menu', { name: 'Guide context menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Show two-point perspective guide' }).click();

  const overlay = page.locator('.perspective-guide-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.perspective-guide-overlay__ray')).toHaveCount(14);
  await expect(overlay.locator('.perspective-guide-overlay__vertical')).toHaveCount(7);
  const leftHandle = page.getByRole('button', { name: 'Left vanishing point' });
  const leftBefore = Number(await leftHandle.getAttribute('data-screen-x'));
  const handleBounds = await leftHandle.boundingBox();
  if (!handleBounds) throw new Error('left vanishing point handle was not found');
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2 + 48,
    handleBounds.y + handleBounds.height / 2 + 24,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await leftHandle.getAttribute('data-screen-x')))
    .toBeGreaterThan(leftBefore + 30);
  expect(await contentHash(page)).toBe(before);

  await page.screenshot({ path: testInfo.outputPath('perspective-guide-light-desktop.png') });
  await canvas.screenshot({ path: testInfo.outputPath('perspective-guide-light-closeup.png') });
  for (const theme of ['dark', 'high-contrast'] as const) {
    await page.evaluate((nextTheme) => {
      document.documentElement.setAttribute('data-theme', nextTheme);
    }, theme);
    await page.screenshot({ path: testInfo.outputPath(`perspective-guide-${theme}-desktop.png`) });
    await canvas.screenshot({
      path: testInfo.outputPath(`perspective-guide-${theme}-closeup.png`),
    });
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({
    path: testInfo.outputPath('perspective-guide-high-contrast-narrow.png'),
  });
  await canvas.screenshot({ path: testInfo.outputPath('perspective-guide-narrow-closeup.png') });
  const narrowContentBeforeHide = await contentHash(page);

  const narrowCanvasBounds = await canvas.boundingBox();
  const narrowGuideX = Number(await guideLine.getAttribute('x1'));
  if (!narrowCanvasBounds) throw new Error('narrow canvas was not found');
  await page.mouse.click(
    narrowCanvasBounds.x + narrowGuideX,
    narrowCanvasBounds.y + narrowCanvasBounds.height / 2,
    { button: 'right' },
  );
  const hideMenu = page.getByRole('menu', { name: 'Guide context menu' });
  await hideMenu.getByRole('menuitem', { name: 'Hide two-point perspective guide' }).click();
  await expect(overlay).toHaveCount(0);
  expect(await contentHash(page)).toBe(narrowContentBeforeHide);
});
