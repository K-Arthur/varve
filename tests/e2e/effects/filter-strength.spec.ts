import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

const requireFromEngine = createRequire(resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

const review = 'reports/effects-repair';

test('neutral partial-strength filter preserves a cutout through the real inspector', async ({
  page,
}) => {
  mkdirSync(review, { recursive: true });
  await navigateToCleanEditor(page);
  // PNG alpha belongs to the source pixels, rather than object opacity applied
  // after filtering. This catches duplicate coverage inside the filter surface.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(200,80,40,0.5)';
    ctx.fillRect(20, 20, 160, 120);
    return canvas.toDataURL().split(',')[1]!;
  });
  await page.locator('#file-import-input').setInputFiles({
    name: 'semitransparent-cutout.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const sample = () =>
    canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! > data[i + 1]! + 40 && data[i + 3]! > 0) {
          return Array.from(data.slice(i, i + 4));
        }
      }
      return [];
    });
  await expect.poll(sample).not.toEqual([]);
  const before = await sample();
  await canvas.screenshot({ path: `${review}/strength-before.png` });
  const section = page.getByRole('button', { name: 'Object Filters', exact: true });
  await section.scrollIntoViewIfNeeded();
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  await page.getByRole('combobox', { name: 'Add Object Filter' }).click();
  await page.getByRole('option', { name: 'Brightness', exact: true }).click();
  const strength = page.getByRole('spinbutton', { name: 'Brightness effect opacity value' });
  await strength.fill('50');
  await strength.press('Enter');
  await expect(page.getByRole('slider', { name: 'Brightness effect opacity' })).toHaveValue('50');
  // Editing to zero then back also proves the result was repainted: a stale
  // frame cannot satisfy the explicit non-neutral step followed by neutral.
  const brightness = page.getByRole('slider', { name: 'Brightness', exact: true });
  await brightness.press('Home');
  await expect.poll(sample).not.toEqual(before);
  await brightness.press('End');
  await brightness.press('Home');
  // Numeric fields preserve exact typed values; reset the correction to neutral.
  const value = page.getByRole('spinbutton', { name: 'Brightness value', exact: true });
  await value.fill('0');
  await value.press('Enter');
  await expect
    .poll(async () => {
      const after = await sample();
      return after.length === 4 ? Math.max(...after.map((v, i) => Math.abs(v - before[i]!))) : 255;
    })
    .toBeLessThanOrEqual(2);
  await page.screenshot({ path: `${review}/strength-inspector.png` });
  await canvas.screenshot({ path: `${review}/strength-after.png` });
  await strength.fill('25');
  await strength.press('Enter');
  await strength.blur();
  await page.keyboard.press('Control+z');
  await expect(strength).toHaveValue('50');
  await page.keyboard.press('Control+Shift+z');
  await expect(strength).toHaveValue('25');
  await strength.fill('50');
  await strength.press('Enter');
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  await page
    .locator('.spec-export__group')
    .getByRole('button', { name: 'PNG', exact: true })
    .click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /download/i }).click();
  const download = await pending;
  const output = `${review}/strength-export.png`;
  await download.saveAs(output);
  // Independent PNG decoder checks actual output alpha, not Varve reimport.
  const exported = PNG.sync.read(readFileSync(output));
  const alpha = new Set<number>();
  for (let i = 3; i < exported.data.length; i += 4) alpha.add(exported.data[i]!);
  expect(alpha.has(128)).toBe(true);
  expect(Math.max(...alpha)).toBeLessThanOrEqual(129);
});
