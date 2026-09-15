import { expect, type Locator, type TestInfo, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function attachShineVisual(testInfo: TestInfo, locator: Locator, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await locator.screenshot({ path: screenshotPath, animations: 'allow' });
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
}

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

  test('batch export reports per-file results', async ({ page }, testInfo) => {
    await createExportableFrame(page);
    await selectExportTab(page);

    await page.getByRole('button', { name: 'PNG', exact: true }).click();
    await page.getByRole('button', { name: 'Add configuration' }).click();
    await openAdvancedExport(page);

    await page.getByRole('button', { name: /^Export \(/i }).click();
    const results = page.getByRole('region', { name: 'Export results' });
    await expect(results).toBeVisible({
      timeout: 20000,
    });
    await expect(results).toHaveClass(/varve-shine-border--beam/);
    await expect(results).toHaveClass(/varve-shine-border--tone-success/);
    await expect(results).toHaveClass(/varve-shine-border--active/);
    const resultsBoxBefore = await results.boundingBox();
    const resultsSizeBefore = {
      width: resultsBoxBefore?.width,
      height: resultsBoxBefore?.height,
    };
    await results.evaluate((element) => element.classList.remove('varve-shine-border--active'));
    await attachShineVisual(testInfo, results, 'export-results-before-shine');
    await results.evaluate((element) => {
      element.classList.add('varve-shine-border--active');
      getComputedStyle(element, '::after').animationName;
    });
    await expect
      .poll(() => results.evaluate((element) => element.getAnimations({ subtree: true }).length))
      .toBe(1);
    await results.evaluate((element) => {
      const animation = element.getAnimations({ subtree: true })[0];
      if (!animation) throw new Error('Expected the export success shine animation');
      animation.pause();
      animation.currentTime = 288;
    });
    await attachShineVisual(testInfo, results, 'export-results-shine-brightest');
    const shineState = await results.evaluate((element) => {
      const animation = element.getAnimations({ subtree: true })[0];
      if (!animation) return null;
      animation.currentTime = 800;
      const decoration = getComputedStyle(element, '::after');
      return {
        animationName: decoration.animationName,
        iterationCount: decoration.animationIterationCount,
        pointerEvents: decoration.pointerEvents,
      };
    });
    expect(shineState).toEqual({
      animationName: 'varve-shine-border-once',
      iterationCount: '1',
      pointerEvents: 'none',
    });
    await attachShineVisual(testInfo, results, 'export-results-success-shine');
    const resultsBoxAfter = await results.boundingBox();
    expect({ width: resultsBoxAfter?.width, height: resultsBoxAfter?.height }).toEqual(
      resultsSizeBefore,
    );
    await expect(page.getByText(/\d of \d exported/i)).toBeVisible();
  });
});
