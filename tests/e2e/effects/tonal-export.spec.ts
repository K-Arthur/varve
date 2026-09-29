import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

const requireEngine = createRequire(path.resolve('packages/engine/package.json'));
const { PNG } = requireEngine('pngjs') as {
  PNG: { sync: { read(bytes: Buffer): { width: number; height: number; data: Buffer } } };
};
const review = path.resolve('reports/ui-review/tonal-workflows');
async function number(page: Page, name: string, value: string) {
  const input = page.getByRole('spinbutton', { name, exact: true });
  await input.fill(value);
  await input.press('Enter');
  await input.blur();
}
async function add(page: Page, name: string) {
  const section = page.getByRole('button', { name: 'Object Filters', exact: true });
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  await page.getByRole('combobox', { name: 'Add Object Filter', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}
async function exportTab(page: Page) {
  const tab = page.getByRole('tab', { name: 'Export', exact: true });
  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
}
async function download(page: Page, format: string) {
  await page
    .locator('.spec-export__group')
    .getByRole('radio', { name: format, exact: true })
    .click();
  if (format === 'PNG')
    await page
      .getByRole('radiogroup', { name: 'Export scale', exact: true })
      .getByRole('radio', { name: '2x', exact: true })
      .click();
  const pending = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: /download/i }).click();
  const result = await pending;
  const output = path.join(review, `08-tonal-object.${format.toLowerCase()}`);
  await result.saveAs(output);
  return output;
}

test('all tonal object filters survive real PNG, SVG and PDF export with the source retained', async ({
  page,
}) => {
  page.setDefaultTimeout(15000);
  mkdirSync(review, { recursive: true });
  await navigateToCleanEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/tonal-reference.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await add(page, 'Curves');
  await number(page, 'Curve output', '12.5');
  await add(page, 'Channel Mixer');
  await number(page, 'Red percent', '90');
  await number(page, 'Green percent', '10');
  await add(page, 'White Balance');
  await number(page, 'Relative warmth value', '8');
  await add(page, 'Split Toning');
  await number(page, 'Shadow saturation value (%)', '18');
  await number(page, 'Highlight saturation value (%)', '15');
  await add(page, 'Sharpen');
  await number(page, 'Sharpen amount value (%)', '65');
  await number(page, 'Sharpen radius value (units)', '3');
  await page.keyboard.press('Shift+1');
  await page.screenshot({ path: path.join(review, '08-tonal-object-stack.png') });
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await exportTab(page);
  const png = PNG.sync.read(readFileSync(await download(page, 'PNG')));
  // A creative tone changes the reference color but preserves source coverage.
  const flat = Array.from(
    png.data.subarray((10 * png.width + 10) * 4, (10 * png.width + 10) * 4 + 4),
  );
  expect(flat[3]).toBe(255);
  expect(flat.slice(0, 3)).not.toEqual([145, 132, 117]);
  let opaque = 0;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] === 255) opaque++;
  expect(opaque).toBe(512 * 384 * 4);
  const svg = readFileSync(await download(page, 'SVG'), 'utf8');
  const images = [...svg.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
  expect(images.length).toBeGreaterThan(0);
  const hasFilteredPatch = images.some((match) => {
    const image = PNG.sync.read(Buffer.from(match[1]!, 'base64'));
    for (let i = 0; i < image.data.length; i += 4)
      if (image.data.subarray(i, i + 4).every((value, c) => value === flat[c])) return true;
    return false;
  });
  expect(hasFilteredPatch).toBe(true);
  const pdf = readFileSync(await download(page, 'PDF'));
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  // A valid header/image object can still contain incorrectly packed pixels.
  // Poppler is optional on other CI hosts; scalar stream/xref/alpha tests are
  // always run. The local visual lane requires and opens this independent render.
  if (spawnSync('pdftoppm', ['-v']).status === 0) {
    const prefix = path.join(review, '08-pdf-render');
    execFileSync('pdftoppm', [
      '-f',
      '1',
      '-singlefile',
      '-scale-to-x',
      String(png.width),
      '-scale-to-y',
      String(png.height),
      '-png',
      path.join(review, '08-tonal-object.pdf'),
      prefix,
    ]);
    const rendered = PNG.sync.read(readFileSync(`${prefix}.png`));
    for (const [x, y] of [
      [10, 10],
      [png.width / 2, png.height / 2],
      ...[0.125, 0.375, 0.625, 0.875].map((f) => [
        Math.floor(png.width * f),
        Math.floor(png.height * 0.85),
      ]),
    ]) {
      const offset = (Math.floor(y!) * png.width + Math.floor(x!)) * 4;
      for (let c = 0; c < 3; c++)
        expect(Math.abs(rendered.data[offset + c]! - png.data[offset + c]!)).toBeLessThanOrEqual(2);
    }
  } else
    test.info().annotations.push({
      type: 'PDF render unavailable',
      description: 'Poppler is absent; independent PDF pixel render was not run on this host.',
    });
  // Reopen real library storage and inspect editable parameters; no context
  // injection or screenshot RGB is used as an adjustment source.
  await page.reload();
  await page.getByRole('gridcell').first().waitFor({ timeout: 30000 });
  await page.getByRole('gridcell').first().dblclick();
  await page.getByRole('treeitem', { name: /tonal-reference/ }).click();
  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  const section = page.getByRole('button', { name: 'Object Filters', exact: true });
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  await expect(page.locator('ul[aria-label="Object Filter stack"] > li')).toHaveCount(5);
  await expect(page.getByRole('treeitem', { name: /tonal-reference/ })).toBeVisible();
});
