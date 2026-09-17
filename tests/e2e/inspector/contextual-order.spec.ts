/**
 * Contextual Inspector ordering — real document workflows.
 *
 * This spec intentionally creates a frame, vector shape, live text layer, and
 * imported photograph. It protects the primary-band decision without relying
 * on synthetic registry fixtures alone.
 */
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const REAL_PHOTO = path.resolve('tests/e2e/fixtures/real-life-still-life.jpg');

async function createFrame(page: Page): Promise<void> {
  await page.keyboard.press('f');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.click({ position: { x: 640, y: 380 } });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
}

async function drawFrame(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('f');
  await page.mouse.move(box.x + 120, box.y + 140);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 440, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
}

async function selectFromCombobox(page: Page, label: string, optionLabel: string): Promise<void> {
  const combo = page.getByRole('combobox', { name: label });
  await combo.scrollIntoViewIfNeeded();
  await combo.click();
  await page.getByRole('listbox', { name: label }).waitFor({ state: 'visible', timeout: 3000 });
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

async function drawRectangle(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 260, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });
}

async function createText(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 220, box.y + 460);
  const inline = page.getByRole('textbox', { name: /editing text/i });
  await inline.waitFor({ timeout: 10_000 });
  await page.keyboard.type('Quarterly report');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 10_000 });
}

async function seedDocument(page: Page): Promise<void> {
  await navigateToEditor(page);
  await createFrame(page);
  await drawRectangle(page);
  await createText(page);
  await page.locator('#file-import-input').setInputFiles(REAL_PHOTO);
  await expect(page.getByRole('treeitem')).toHaveCount(4, { timeout: 20_000 });
}

async function selectLayer(page: Page, name: RegExp): Promise<void> {
  const row = page.getByRole('treeitem').filter({ hasText: name }).first();
  await row.waitFor({ timeout: 10_000 });
  await expect(async () => {
    await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

async function openDesign(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Design' }).click();
  await expect(page.locator('#insp-tabpanel-properties')).toBeVisible({ timeout: 10_000 });
}

async function sectionTitles(page: Page): Promise<string[]> {
  return page
    .locator('#insp-tabpanel-properties .insp-disclosure__trigger')
    .evaluateAll((buttons) => buttons.map((button) => (button.textContent ?? '').trim()));
}

test.describe('contextual Inspector order', () => {
  test.describe.configure({ retries: 1 });

  test('puts Typography first for a real selected text layer', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedDocument(page);
    await selectLayer(page, /Quarterly report/);
    await openDesign(page);

    const titles = await sectionTitles(page);
    const typography = titles.indexOf('Typography');
    const position = titles.indexOf('Position & Size');
    const appearance = titles.indexOf('Appearance');

    expect(typography, `sections=${titles.join(' → ')}`).toBeGreaterThanOrEqual(0);
    expect(position, `sections=${titles.join(' → ')}`).toBeGreaterThanOrEqual(0);
    expect(appearance, `sections=${titles.join(' → ')}`).toBeGreaterThanOrEqual(0);
    expect(typography).toBeLessThan(position);
    expect(typography).toBeLessThan(appearance);

    await page.locator('#insp-tabpanel-properties').screenshot({
      path: testInfo.outputPath('text-contextual-order.png'),
    });
  });

  test('keeps type-specific controls out of shapes and preserves image/frame grammar', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedDocument(page);

    await selectLayer(page, /Rectangle/);
    await openDesign(page);
    const shapeTitles = await sectionTitles(page);
    expect(shapeTitles).not.toContain('Typography');
    expect(shapeTitles.indexOf('Position & Size')).toBeLessThan(shapeTitles.indexOf('Appearance'));

    await selectLayer(page, /real-life-still-life/);
    await openDesign(page);
    const imageTitles = await sectionTitles(page);
    expect(imageTitles.indexOf('Position & Size')).toBe(0);
    expect(imageTitles.indexOf('Image Placement')).toBeLessThan(imageTitles.indexOf('Appearance'));
    expect(imageTitles.indexOf('Crop & Bounds')).toBeLessThan(imageTitles.indexOf('Appearance'));

    await selectLayer(page, /Frame/);
    await openDesign(page);
    const frameTitles = await sectionTitles(page);
    expect(frameTitles.indexOf('Position & Size')).toBeLessThan(
      frameTitles.indexOf('Stack / Grid'),
    );
    expect(frameTitles).not.toContain('Typography');

    await page.locator('#insp-tabpanel-properties').screenshot({
      path: testInfo.outputPath('image-and-frame-contextual-order.png'),
    });
  });

  test('shows grid placement only for a real child of a grid frame', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await navigateToEditor(page);
    await drawFrame(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 180, box.y + 190);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 300, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });

    await selectLayer(page, /Frame/);
    await openDesign(page);
    await selectFromCombobox(page, 'Layout mode', 'Grid');

    const rectangle = page
      .getByRole('treeitem')
      .filter({ hasText: /Rectangle/ })
      .first();
    await rectangle.click();
    await expect(rectangle).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Layout child', exact: true })).toBeVisible();
    await expect(page.getByText('Grid placement', { exact: true })).toBeVisible();

    const labels = page.locator('.insp-grid-placement .insp-field__label');
    await expect(labels).toHaveCount(4);
    const clippedLabels = await labels.evaluateAll((elements) =>
      elements
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.textContent?.trim()),
    );
    expect(clippedLabels).toEqual([]);

    await page.getByText('Grid placement', { exact: true }).scrollIntoViewIfNeeded();
    await page.locator('#insp-tabpanel-properties').screenshot({
      path: testInfo.outputPath('grid-child-placement.png'),
    });
  });
});
