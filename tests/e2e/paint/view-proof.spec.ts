import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

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

async function expandProofControls(page: import('@playwright/test').Page) {
  const section = page.getByRole('button', { name: /soft proof/i });
  await expect(section).toBeVisible();
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();
}

test('grayscale and mirror checks stay view-only across themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);

  const canvas = page.locator('.editor-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('editor canvas was not found');
  await page.getByTestId('toolbar').getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(bounds.x + bounds.width * 0.28, bounds.y + bounds.height * 0.16);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.43, bounds.y + bounds.height * 0.36, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole('treeitem', { name: /Rectangle 1/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expandProofControls(page);

  const grayscale = page.getByRole('switch', { name: 'Grayscale view' });
  const mirror = page.getByRole('switch', { name: 'Mirror view (read only)' });
  const before = await contentHash(page);

  await grayscale.check();
  await expect(canvas).toHaveAttribute('data-view-proof-grayscale', 'true');
  await expect
    .poll(() => canvas.evaluate((node) => getComputedStyle(node).filter))
    .toBe('grayscale(1)');
  expect(await contentHash(page)).toBe(before);
  await page.screenshot({ path: testInfo.outputPath('view-proof-grayscale-light.png') });
  await canvas.screenshot({ path: testInfo.outputPath('view-proof-grayscale-canvas.png') });

  await grayscale.uncheck();
  await mirror.check();
  await expect(canvas).toHaveAttribute('data-view-proof-mirror', 'true');
  await expect
    .poll(() => canvas.evaluate((node) => getComputedStyle(node).pointerEvents))
    .toBe('none');
  await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveAttribute(
    'tabindex',
    '-1',
  );
  expect(await contentHash(page)).toBe(before);

  await page.getByTestId('toolbar').getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(bounds.x + bounds.width * 0.52, bounds.y + bounds.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.68, bounds.y + bounds.height * 0.34, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(page.getByRole('treeitem', { name: /Rectangle 2/ })).toHaveCount(0);
  expect(await contentHash(page)).toBe(before);
  await page.screenshot({ path: testInfo.outputPath('view-proof-mirror-light.png') });
  await canvas.screenshot({ path: testInfo.outputPath('view-proof-mirror-canvas.png') });

  await grayscale.check();
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: testInfo.outputPath('view-proof-mirror-grayscale-dark.png') });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'high-contrast'));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: testInfo.outputPath('view-proof-high-contrast-narrow.png') });
  const narrowCanvasBeforeRestore = await contentHash(page);

  await grayscale.uncheck();
  await mirror.uncheck();
  await expect(canvas).not.toHaveAttribute('data-view-proof-grayscale');
  await expect(canvas).not.toHaveAttribute('data-view-proof-mirror');
  await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveAttribute(
    'tabindex',
    '0',
  );
  expect(await contentHash(page)).toBe(narrowCanvasBeforeRestore);
});
