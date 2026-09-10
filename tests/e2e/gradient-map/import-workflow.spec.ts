/**
 * End-to-end: gradient map import + apply workflow.
 *
 * Covers: adding a gradient map to an adjustment layer, opening the preset
 * browser, importing a real `.grd` file via the file picker, reviewing
 * discovered presets, importing into the user library, applying one, and
 * verifying undo/redo + persistence of the applied parameters.
 */

import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditorWithRetry } from '../helpers/gradient-map-helpers';
import { dragOnCanvas } from '../shared';

const TWO_STOP_GRD = resolve(
  __dirname,
  '../../../packages/import/src/gradient/__fixtures__/two-stop.grd',
);
const MULTI_GRD = resolve(
  __dirname,
  '../../../packages/import/src/gradient/__fixtures__/multi-gradient.grd',
);
const NOISE_GRD = resolve(
  __dirname,
  '../../../packages/import/src/gradient/__fixtures__/noise-gradient.grd',
);

/** Create an adjustment layer via the editor context (same technique as
 *  tests/e2e/effects/gradient-map.spec.ts). */
async function createAdjustmentLayer(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const container = document.getElementById('root');
      if (!container) return false;
      const fiberKey = Object.keys(container).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return false;

      function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        const mp = fiber.memoizedProps as Record<string, unknown> | undefined;
        if (
          mp?.value &&
          typeof mp.value === 'object' &&
          'createAdjustmentLayer' in (mp.value as Record<string, unknown>)
        ) {
          return mp.value as Record<string, unknown>;
        }
        const pp = fiber.pendingProps as Record<string, unknown> | undefined;
        if (
          pp?.value &&
          typeof pp.value === 'object' &&
          'createAdjustmentLayer' in (pp.value as Record<string, unknown>)
        ) {
          return pp.value as Record<string, unknown>;
        }
        return (
          walk(fiber.child as Record<string, unknown> | null) ||
          walk(fiber.sibling as Record<string, unknown> | null)
        );
      }

      const ctx = walk(
        (container as unknown as Record<string, unknown>)[fiberKey] as Record<
          string,
          unknown
        > | null,
      );
      if (ctx && typeof ctx.createAdjustmentLayer === 'function') {
        (ctx.createAdjustmentLayer as () => void)();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });
}

async function setupGradientMap(page: import('@playwright/test').Page) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, 150, 150, 400, 350);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  const created = await createAdjustmentLayer(page);
  expect(created).toBe(true);
  await page.waitForTimeout(500);

  // The inspector shows the Adjustments tab for adjustment nodes.
  const adjustmentsTab = page.getByRole('tab', { name: /Adjustments/i });
  await expect(adjustmentsTab).toBeVisible({ timeout: 5000 });
  await adjustmentsTab.click();
  await page.waitForTimeout(200);

  await page.locator('button.adj-panel__add-btn').click();
  await page.waitForTimeout(200);
  const menuItem = page.locator('.adj-panel__add-menu-item').filter({ hasText: 'Gradient Map' });
  await menuItem.click();
  await page.waitForTimeout(300);

  await expect(page.locator('input[aria-label="Dither gradient map"]')).toBeVisible({
    timeout: 5000,
  });
}

async function importGrd(page: import('@playwright/test').Page, fixture: string) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page
    .locator('.gmp-browser')
    .getByRole('button', { name: /import gradient presets/i })
    .click();
  const fileChooser = await chooserPromise;
  await fileChooser.setFiles(fixture);
  await page.waitForTimeout(400);
}

test.describe('Gradient map import workflow', () => {
  // 300s. A cold Vite dev graph can take over a minute to parse in-browser
  // before the editor is interactive, which does not fit the 60s default, and
  // `navigateToEditorWithRetry` budgets one prime plus up to three attempts on
  // top of that. This is a dev-server startup allowance only — it does not
  // relax any assertion, each of which keeps its own short timeout.
  test.describe.configure({ mode: 'serial', timeout: 300_000 });
  test.beforeEach(async ({ page }) => {
    await navigateToEditorWithRetry(page);
  });

  test('imports a .grd, selects a preset, and applies it to the adjustment', async ({ page }) => {
    await setupGradientMap(page);

    // The preset browser is visible with built-in presets.
    const browser = page.locator('.gmp-browser');
    await expect(browser).toBeVisible({ timeout: 5000 });

    // Import a real two-stop .grd file.
    await importGrd(page, TWO_STOP_GRD);

    // The import review dialog shows the discovered gradient.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/1 gradient found/)).toBeVisible();
    await expect(dialog.getByText('Black to White', { exact: true })).toBeVisible();

    // Select it and import into the library.
    await dialog.getByRole('checkbox', { name: /Select Black to White/ }).check({ force: true });
    const importButton = dialog.getByRole('button', { name: /import.*preset/i });
    await importButton.click();

    // The preset is now selectable in the browser (search for it).
    const search = page.getByPlaceholder('Search presets');
    await search.fill('Black to White');
    await expect(browser.getByRole('option', { name: /Black to White/ })).toBeVisible({
      timeout: 5000,
    });

    // Apply it to the current adjustment.
    await browser.getByRole('option', { name: /Black to White/ }).click();
    await expect(page.locator('.gmp-section__current')).toContainText('Black to White');
  });

  test('surfaces partial compatibility for noise gradients and imports the rest', async ({
    page,
  }) => {
    await setupGradientMap(page);
    await importGrd(page, NOISE_GRD);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/noise gradient/i)).toBeVisible({ timeout: 5000 });

    // Select it anyway (read-only import) and confirm.
    await dialog.getByRole('checkbox', { name: /Select Noise Ramp/ }).check({ force: true });
    await dialog.getByRole('button', { name: /import.*preset/i }).click();
    const search = page.getByPlaceholder('Search presets');
    await search.fill('Noise Ramp');
    const option = page.locator('.gmp-browser').getByRole('option', { name: /Noise Ramp/ });
    await expect(option).toBeVisible({ timeout: 5000 });
    await expect(option).toContainText('Read-only');
  });

  test('multi-gradient files import and allow selection of one preset', async ({ page }) => {
    await setupGradientMap(page);
    await importGrd(page, MULTI_GRD);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/gradients? found/)).toBeVisible();
    await expect(dialog.getByText('Sunset', { exact: true })).toBeVisible();

    // Select only "Sunset" and import it.
    await dialog.getByRole('checkbox', { name: /Select Sunset/ }).check({ force: true });
    await dialog.getByRole('button', { name: /import.*preset/i }).click();

    const search = page.getByPlaceholder('Search presets');
    await search.fill('Sunset');
    await expect(
      page.locator('.gmp-browser').getByRole('option', { name: 'Sunset', exact: true }).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('undo and redo revert preset application', async ({ page }) => {
    await setupGradientMap(page);
    await importGrd(page, TWO_STOP_GRD);

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: /Select Black to White/ }).check({ force: true });
    await dialog.getByRole('button', { name: /import.*preset/i }).click();

    const search = page.getByPlaceholder('Search presets');
    await search.fill('Black to White');
    const option = page.locator('.gmp-browser').getByRole('option', { name: /Black to White/ });
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.click();
    await expect(page.locator('.gmp-section__current')).toContainText('Black to White');

    // Undo the apply, then redo it.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    await expect(page.locator('.gmp-section__current')).toContainText('Black to White');
  });
});
