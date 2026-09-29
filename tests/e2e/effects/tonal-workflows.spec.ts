import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function navigateTonalEditor(page: Page) {
  try {
    await navigateToEditor(page);
  } catch (error) {
    // The shared startup helper can observe a transient shell before web
    // storage returns to Home. Continue through the actual created file card.
    const card = page.getByRole('gridcell').first();
    if (!(await card.isVisible().catch(() => false))) throw error;
    await card.dblclick();
    await page
      .locator('canvas.editor-canvas__content-layer')
      .waitFor({ state: 'visible', timeout: 30000 });
  }
}

const review = path.resolve('reports/ui-review/tonal-workflows');
async function add(page: Page, name: string) {
  await page.getByRole('button', { name: /add adjustment/i }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function number(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name, exact: true });
  await field.fill(value);
  await field.press('Enter');
}
test('retains curve channels, precise points and mixer rows through actual controls', async ({
  page,
}) => {
  mkdirSync(review, { recursive: true });
  await navigateTonalEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.keyboard.press('Shift+1');
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await expect(page.locator('.adj-panel__header-name')).toHaveText('Adjustment Filters');
  await add(page, 'Curves');
  await page.getByRole('radio', { name: 'R', exact: true }).click();
  await number(page, 'Curve output', '12.5');
  await page.getByRole('radio', { name: 'B', exact: true }).click();
  await number(page, 'Curve output', '5.25');
  await page.getByRole('radio', { name: 'R', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Curve output', exact: true })).toHaveValue(
    '12.5',
  );
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await number(page, 'Curve input', '77.25');
  await number(page, 'Curve output', '144.75');
  const graph = page.getByRole('img', { name: /Curve editor/ });
  await graph.scrollIntoViewIfNeeded();
  const graphBox = await graph.boundingBox();
  const panelBox = await page.getByRole('region', { name: 'Inspector', exact: true }).boundingBox();
  expect(graphBox!.width).toBeLessThanOrEqual(panelBox!.width);
  await page.screenshot({ path: path.join(review, '01-curves-light.png') });
  await add(page, 'Channel Mixer');
  await number(page, 'Red percent', '70');
  await page.getByRole('combobox', { name: 'Output channel', exact: true }).click();
  await page.getByRole('option', { name: 'Blue', exact: true }).click();
  await number(page, 'Green percent', '30');
  await page.getByRole('combobox', { name: 'Output channel', exact: true }).click();
  await page.getByRole('option', { name: 'Red', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Red percent', exact: true })).toHaveValue(
    '70',
  );
  await page.screenshot({ path: path.join(review, '02-mixer-light.png') });
});

test('white balance samples upstream pixels, repeats, undoes, and split toning has real controls', async ({
  page,
}) => {
  await navigateTonalEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/tonal-reference.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.keyboard.press('Shift+1');
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await add(page, 'White Balance');
  await expect(
    page.getByRole('button', { name: 'Sample neutral patch', exact: true }),
  ).toBeVisible();
  await number(page, 'Source sample X', '20');
  await number(page, 'Source sample Y', '20');
  await page.getByRole('button', { name: 'Sample neutral patch', exact: true }).click();
  const red = page.getByRole('spinbutton', { name: 'red gain', exact: true });
  await expect(red).not.toHaveValue('1');
  const gain = await red.inputValue();
  await page.getByRole('button', { name: 'Sample neutral patch', exact: true }).click();
  await expect(red).toHaveValue(gain);
  await page.getByRole('button', { name: 'Reset white balance', exact: true }).click();
  await expect(red).toHaveValue('1');
  await page.keyboard.press('Control+z');
  await expect(red).toHaveValue(gain);
  await page.screenshot({ path: path.join(review, '03-white-balance-light.png') });
  await add(page, 'Split Toning');
  await page.getByRole('combobox', { name: 'Split tone preset', exact: true }).click();
  await page.getByRole('option', { name: 'Cool shadows · warm highlights', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Shadow saturation value (%)', exact: true }),
  ).toHaveValue('18');
  await number(page, 'Shadow range pivot value (%)', '61');
  await page.screenshot({ path: path.join(review, '04-split-tone-light.png') });
  await page.getByRole('button', { name: 'Reset split toning', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Shadow saturation value (%)', exact: true }),
  ).toHaveValue('0');
});

test('channel inspection creates reusable selection coverage through the existing inspector', async ({
  page,
}) => {
  await navigateTonalEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/tonal-reference.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Selection Sources', exact: true }).click();
  await page.getByRole('button', { name: 'Channels · selected image source', exact: true }).click();
  await page.getByRole('combobox', { name: 'Inspect channel', exact: true }).click();
  await page.getByRole('option', { name: 'Red', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Channel to selection', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Channel to selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save selection', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save selection', exact: true }).click();
  // Pixel-selection context mounts the same source panel afresh; view state is transient.
  await page.getByRole('button', { name: 'Channels · selected image source', exact: true }).click();
  await page.getByRole('button', { name: 'Restore composite', exact: true }).click();
  await page.screenshot({ path: path.join(review, '05-channel-selection.png') });
});
