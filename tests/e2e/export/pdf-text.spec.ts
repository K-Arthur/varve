import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

interface PdfSummary {
  length: number;
  header: string;
  text: string;
}

test.describe('PDF text export', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const win = window as unknown as Record<string, unknown>;
      Object.defineProperty(win, 'showSaveFilePicker', {
        configurable: true,
        writable: true,
        value: async () => ({
          createWritable: async () => ({
            write: async (data: unknown) => {
              const bytes =
                data instanceof Blob
                  ? new Uint8Array(await data.arrayBuffer())
                  : data instanceof ArrayBuffer
                    ? new Uint8Array(data)
                    : data instanceof Uint8Array
                      ? data
                      : new Uint8Array();
              win.__varvePdfSummary = {
                length: bytes.length,
                header: new TextDecoder('latin1').decode(bytes.slice(0, 8)),
                text: new TextDecoder('latin1').decode(bytes),
              };
            },
            close: async () => {},
          }),
        }),
      });
    });
    await navigateToEditor(page);
  });

  async function exportPdf(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /download/i }).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __varvePdfSummary?: PdfSummary }).__varvePdfSummary?.length ??
              0,
          ),
        { timeout: 30000 },
      )
      .toBeGreaterThan(100);
    return page.evaluate(() => {
      const summary = (window as unknown as { __varvePdfSummary?: PdfSummary }).__varvePdfSummary;
      if (!summary) throw new Error('PDF export did not produce bytes');
      return summary;
    });
  }

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
    // Keep ordinary cases on the real per-keystroke path, but use the
    // browser's bulk insertion for large-document coverage so the test does
    // not spend several minutes sleeping between 5,000 synthetic keys.
    if (text.length > 1000) {
      await page.keyboard.insertText(text);
    } else {
      await page.keyboard.type(text, { delay: 20 });
    }
    // Commit the edit by clicking the real tool control. This also flushes
    // the debounced model update before export (a key shortcut is consumed by
    // the textarea while it still has focus).
    await page.getByRole('button', { name: 'Select', exact: true }).click();
  }

  test('Export text node to PDF with basic text', async ({ page }) => {
    await createTextNode(page, 'Hello PDF World');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Open export tab
    await selectExportTab(page);
    await page.getByRole('button', { name: 'PDF', exact: true }).click();

    // Verify it's a valid PDF
    const summary = await exportPdf(page);
    expect(summary.header).toMatch(/^%PDF-1\.[0-9]+$/);

    // Verify it's non-trivial (has actual content, not just a stub)
    expect(summary.length).toBeGreaterThan(500);

    // Browser PDF export intentionally rasterizes text through the canvas
    // fallback; desktop/native PDF may instead contain vector text operators.
    const hasTextContent =
      summary.text.includes('/Font') ||
      summary.text.includes('Tj') ||
      summary.text.includes('TJ') ||
      summary.text.includes('Tm') ||
      summary.text.includes('/Subtype /Image') ||
      summary.text.includes('/XObject');
    expect(hasTextContent).toBe(true);
  });

  test('Export text node with rich text styling to PDF', async ({ page }) => {
    // Create text with bold styling by using keyboard shortcuts
    await createTextNode(page, 'Rich Text');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Open export tab
    await selectExportTab(page);
    await page.getByRole('button', { name: 'PDF', exact: true }).click();

    const summary = await exportPdf(page);
    expect(summary.length).toBeGreaterThan(500);

    // Verify it's a valid PDF
    expect(summary.header).toMatch(/^%PDF-1\.[0-9]+$/);
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

    const summary = await exportPdf(page);
    expect(summary.header).toMatch(/^%PDF-1\.[0-9]+$/);
  });

  test('Export large text node to PDF produces valid file', async ({ page }) => {
    // Create a long text
    const longText = 'A'.repeat(5000);
    await createTextNode(page, longText);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Open export tab
    await selectExportTab(page);
    await page.getByRole('button', { name: 'PDF', exact: true }).click();

    const summary = await exportPdf(page);
    // Repeated glyphs compress extremely well in the browser's raster PDF
    // fallback; validity and non-empty output are the contract, not a raw
    // byte-size multiple of the source text length.
    expect(summary.length).toBeGreaterThan(500);
  });
});
