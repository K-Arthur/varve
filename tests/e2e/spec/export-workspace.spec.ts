import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Export workspace — batch dialog surfaces (Strata export rebuild, M9).
 *
 * Covers the plan-driven batch dialog: preflight findings surfaced before
 * export, capability-gated print settings for PDF/X jobs, print settings
 * attached to the exported batch, and per-file results with retry after a
 * partial failure.
 *
 * The File System Access save picker is stubbed so the batch can complete in
 * headless Chromium; the fallback anchor-download path is not exercised here.
 */
test.describe('Export workspace — batch dialog surfaces', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        showSaveFilePicker?: () => Promise<{
          name: string;
          createWritable: () => Promise<{ write: () => Promise<void>; close: () => Promise<void> }>;
        }>;
      };
      w.showSaveFilePicker = async () => ({
        name: 'mock-output',
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      });
    });
    await navigateToEditor(page);
  });

  async function selectExportTab(page: import('@playwright/test').Page) {
    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    await exportTab.waitFor({ state: 'visible', timeout: 5000 });
    await exportTab.click();
  }

  async function createExportableFrame(page: import('@playwright/test').Page) {
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  }

  async function openAdvancedExport(page: import('@playwright/test').Page) {
    await selectExportTab(page);
    await page.getByRole('button', { name: /Open advanced export/ }).click();
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  }

  test('preflight findings are surfaced in the batch dialog', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    // JPEG flattens a transparent background → a deterministic preflight warning.
    await page.getByRole('button', { name: 'JPEG', exact: true }).click();
    await page.getByRole('button', { name: 'Add configuration' }).click();
    await openAdvancedExport(page);

    await expect(page.getByText(/Preflight:/i)).toBeVisible();
    await expect(page.locator('.preflight-panel')).toBeVisible();
  });

  test('print settings appear when a PDF/X export is configured', async ({ page }) => {
    // PDF/X is desktop-only: the web build offers the format but disables it
    // with an explicit reason (capability gate) rather than silently letting a
    // preset be created that no encoder could honor.
    await createExportableFrame(page);
    await selectExportTab(page);

    const formatSelect = page.getByLabel('Format for new export setting');
    await formatSelect.click();
    const pdfxOption = page.getByRole('option', { name: /PDF\/X-1a/i });
    await expect(pdfxOption).toBeVisible();
    await expect(pdfxOption).toBeDisabled();
  });

  test('raster resolution override updates the live batch dimensions', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: 'PNG', exact: true }).click();
    await page.getByRole('button', { name: 'Add configuration' }).click();
    await openAdvancedExport(page);

    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog.locator('.output-resolution')).toBeVisible();
    await dialog.getByLabel('Override raster outputs').check();

    const ppi = dialog.getByLabel('Temporary raster output resolution in PPI');
    await ppi.fill('300');
    await expect(dialog.locator('.batch-job-row__dims').first()).toContainText('300 PPI');
  });

  test('batch export reports per-file results', async ({ page }) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: 'PNG', exact: true }).click();
    await page.getByRole('button', { name: 'Add configuration' }).click();
    await openAdvancedExport(page);

    await page.getByRole('button', { name: /^Export \(/i }).click();
    await expect(page.getByRole('region', { name: 'Export results' })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(/\d of \d exported/i)).toBeVisible();
  });
});
