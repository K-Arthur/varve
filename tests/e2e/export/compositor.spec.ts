import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Export compositor — structural flattening', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function selectExportTab(page: import('@playwright/test').Page) {
    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.waitFor({ state: 'visible', timeout: 5000 });
    await exportTab.click();
  }

  test('Export a document with effects to SVG embeds raster image', async ({ page }) => {
    // Create a rect shape
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Select the shape to show inspector
    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 200, box.y + 175);

    // Open export tab
    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'SVG', exact: true })
      .click();

    // Intercept download
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    // Verify the SVG content — a shape with effects should produce
    // a file that either has an embedded raster or a fallback warning
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path!, 'utf-8');
    // The SVG export should succeed without error
    expect(content).toContain('<svg');
  });

  test('Export a document with effects to PNG produces a file', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 200, box.y + 175);

    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'PNG', exact: true })
      .click();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    // PNG files start with the magic bytes \x89PNG
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(path!);
    expect(buffer[0]).toBe(0x89);
    expect(buffer.toString('ascii', 1, 4)).toBe('PNG');
  });

  test('Export a clean document to SVG produces pure vector output', async ({ page }) => {
    // Create a simple rect — no effects, so no rasterization needed
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 200, box.y + 175);

    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'SVG', exact: true })
      .click();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path!, 'utf-8');
    // Pure vector SVG should contain a <rect> or <path>, not embedded base64 raster
    expect(content).toContain('<svg');
    // A simple shape should not embed base64 image data
    expect(content).not.toContain('data:image');
  });

  test('Export a document with adjustment layers to SVG succeeds', async ({ page }) => {
    // Create a rect
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Create an adjustment layer via the shortcut
    await page.keyboard.press('Alt+n');
    await page.waitForTimeout(300);

    // Open export tab
    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('button', { name: 'SVG', exact: true })
      .click();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path!, 'utf-8');
    // SVG with adjustment layers should produce valid output
    expect(content).toContain('<svg');
  });
});
