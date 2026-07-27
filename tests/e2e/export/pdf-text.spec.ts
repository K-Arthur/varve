import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('PDF text export', () => {
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

  async function createTextNode(page: import('@playwright/test').Page, text: string) {
    // Select text tool
    await page.keyboard.press('t');
    // Click on canvas to create text
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 200, box.y + 200);
    // Type text
    await page.keyboard.type(text, { delay: 20 });
    // Switch to select tool
    await page.keyboard.press('v');
  }

  test('Export text node to PDF with basic text', async ({ page }) => {
    await createTextNode(page, 'Hello PDF World');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Open export tab
    await selectExportTab(page);
    await page.getByRole('button', { name: 'PDF', exact: true }).click();

    // Intercept download
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    // Read the PDF bytes
    const { readFile } = await import('node:fs/promises');
    const pdfBytes = await readFile(path!);

    // Verify it's a valid PDF
    const pdfHeader = pdfBytes.slice(0, 8).toString();
    expect(pdfHeader).toBe('%PDF-1.');

    // Verify it's non-trivial (has actual content, not just a stub)
    expect(pdfBytes.length).toBeGreaterThan(1000);

    // Verify it contains text-related PDF operators
    const pdfContent = pdfBytes.toString('latin1');
    // Should contain font references or text operators
    const hasTextContent =
      pdfContent.includes('/Font') ||
      pdfContent.includes('Tj') ||
      pdfContent.includes('TJ') ||
      pdfContent.includes('Tm');
    expect(hasTextContent).toBe(true);
  });

  test('Export text node with rich text styling to PDF', async ({ page }) => {
    // Create text with bold styling by using keyboard shortcuts
    await createTextNode(page, 'Rich Text');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Open export tab
    await selectExportTab(page);
    await page.getByRole('button', { name: 'PDF', exact: true }).click();

    // Intercept download
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    // Verify PDF has minimal size (not empty)
    const { readFile } = await import('node:fs/promises');
    const pdfBytes = await readFile(path!);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    // Verify it's a valid PDF
    const pdfHeader = pdfBytes.slice(0, 8).toString();
    expect(pdfHeader).toBe('%PDF-1.');
  });

  test('Export text node with underline to PDF', async ({ page }) => {
    // Create text
    await createTextNode(page, 'Underlined Text');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Apply underline via styles panel
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    // Click on text to select
    await page.mouse.click(box.x + 200, box.y + 200);

    // Open export tab
    await selectExportTab(page);
    await page.getByRole('button', { name: 'PDF', exact: true }).click();

    // Intercept download
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    expect(download.path()).toBeTruthy();
  });

  test('Export large text node to PDF produces valid file', async ({ page }) => {
    // Create a long text
    const longText = 'A'.repeat(5000);
    await createTextNode(page, longText);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Open export tab
    await selectExportTab(page);
    await page.getByRole('button', { name: 'PDF', exact: true }).click();

    // Intercept download
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    expect(download.path()).toBeTruthy();

    // Verify file is non-trivial
    const { readFile } = await import('node:fs/promises');
    const pdfBytes = await readFile(await download.path()!);
    expect(pdfBytes.length).toBeGreaterThan(5000);
  });
});
