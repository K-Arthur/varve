import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('public browser demo reaches all five tonal editors without a service account', async ({
  page,
}) => {
  page.setDefaultTimeout(15000);
  await page.goto('/?try=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('[data-varve-editor-ready="true"]').waitFor({ timeout: 60000 });
  const decline = page.getByRole('button', { name: 'No thanks', exact: true });
  if (await decline.isVisible()) await decline.click();
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/tonal-reference.png'));
  await expect(page.getByRole('treeitem', { name: /tonal-reference/ })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  for (const [kind, name, value] of [
    ['Curves', 'Curve output', '12.5'],
    ['Channel Mixer', 'Red percent', '90'],
    ['White Balance', 'Relative warmth value', '8'],
    ['Split Toning', 'Shadow saturation value (%)', '18'],
    ['Sharpen', 'Sharpen radius value (units)', '1.75'],
  ]) {
    await page.locator('.adj-panel__add-btn').click();
    await page.getByRole('menuitem', { name: kind!, exact: true }).click();
    const field = page.getByRole('spinbutton', { name: name!, exact: true });
    await field.fill(value!);
    await field.press('Enter');
    await expect(field).toHaveValue(value!);
    await field.blur();
  }
  mkdirSync(path.resolve('reports/ui-review/tonal-workflows'), { recursive: true });
  await page.screenshot({
    path: path.resolve('reports/ui-review/tonal-workflows/09-browser-demo.png'),
  });
});
