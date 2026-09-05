import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { importImageFile } from '../helpers/editor-helpers';
import { navigateToCleanEditor } from '../helpers/nav';

const requireFromEngine = createRequire(resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

const review = 'reports/effects-repair';

async function addFilter(page: import('@playwright/test').Page, name: string): Promise<void> {
  const section = page.getByRole('button', { name: 'Object Filters', exact: true });
  await section.scrollIntoViewIfNeeded();
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  await page.getByRole('combobox', { name: 'Add Object Filter' }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

async function canvasHash(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((el) => {
    const data = (el as HTMLCanvasElement)
      .getContext('2d')!
      .getImageData(0, 0, (el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height).data;
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 4) {
      hash ^= data[i]!;
      hash = Math.imul(hash, 0x01000193);
      hash ^= data[i + 1]!;
      hash = Math.imul(hash, 0x01000193);
      hash ^= data[i + 2]!;
      hash = Math.imul(hash, 0x01000193);
      hash ^= data[i + 3]!;
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
  });
}

test('spatial object filters are discoverable, editable, persistent in the stack, and exported', async ({
  page,
}) => {
  test.setTimeout(240000);
  mkdirSync(review, { recursive: true });
  await navigateToCleanEditor(page);
  await importImageFile(page, 'test-image.png');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await expect.poll(() => canvasHash(page)).not.toBe('811c9dc5');

  await addFilter(page, 'Motion Blur');
  await expect(page.getByRole('slider', { name: 'Distance' })).toBeVisible();
  const motionBefore = await canvasHash(page);
  await page.getByRole('slider', { name: 'Angle' }).fill('35');
  await expect.poll(() => canvasHash(page)).not.toBe(motionBefore);

  await addFilter(page, 'Mosaic');
  await expect(page.getByRole('slider', { name: 'Block size' })).toBeVisible();
  const mosaicBefore = await canvasHash(page);
  await page.getByRole('slider', { name: 'Block size' }).fill('24');
  await expect.poll(() => canvasHash(page)).not.toBe(mosaicBefore);

  await addFilter(page, 'Surface Smooth');
  await expect(page.getByRole('slider', { name: 'Edge sensitivity' })).toBeVisible();
  const smoothBefore = await canvasHash(page);
  await page.getByRole('slider', { name: 'Edge sensitivity' }).fill('48');
  await expect.poll(() => canvasHash(page)).not.toBe(smoothBefore);

  await addFilter(page, 'Edge Ink');
  await expect(page.getByRole('slider', { name: 'Threshold' })).toBeVisible();
  const edgeBefore = await canvasHash(page);
  await page.getByRole('slider', { name: 'Threshold' }).fill('0.35');
  await expect.poll(() => canvasHash(page)).not.toBe(edgeBefore);
  await expect(page.getByRole('treeitem')).toContainText('test-image');
  await page.screenshot({ path: `${review}/spatial-filters-inspector.png` });
  await canvas.screenshot({ path: `${review}/spatial-filters-canvas.png` });

  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  await page
    .locator('.spec-export__group')
    .getByRole('button', { name: 'PNG', exact: true })
    .click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /download/i }).click();
  const download = await pending;
  const output = `${review}/spatial-filters-export.png`;
  await download.saveAs(output);
  const exported = PNG.sync.read(readFileSync(output));
  expect(exported.width).toBeGreaterThan(0);
  expect(exported.height).toBeGreaterThan(0);
  expect([...exported.data].some((value) => value !== 0)).toBe(true);
});
