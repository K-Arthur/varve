/**
 * Bottom bar visual QA — human-review captures, not snapshots.
 *
 * A status bar is a layout decision: a changed pixel here is only useful after
 * a person has judged whether the change is intentional, so this writes plain
 * PNGs to a caller-owned directory instead of asserting against baselines
 * (same convention as `visual/iconography-visual.spec.ts`).
 *
 * Captures cover the four things that changed: the de-duplicated row, the
 * theme variants of the new document-health pill, the tiered narrow row, and
 * the customize dialog that now describes the whole bar.
 *
 * Run with:
 * VARVE_VISUAL_QA_DIR=docs/screenshots/bottom-bar-2026-09-29 npx playwright test \
 *   tests/e2e/visual/bottom-bar-visual.spec.ts --project=chromium --reporter=list
 */

import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

const outputDir = process.env.VARVE_VISUAL_QA_DIR ?? `test-results/visual-qa-bottom-bar`;

async function setTheme(
  page: import('@playwright/test').Page,
  theme: 'light' | 'dark' | 'high-contrast',
) {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
  await page.waitForTimeout(120);
}

/**
 * Clip covering both bottom strips plus a little canvas, so the review image
 * shows the stack in context rather than two floating hairlines.
 */
async function captureBottomStack(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  const status = await page.locator('.editor-status').boundingBox();
  expect(status, 'status bar present').not.toBeNull();
  const selection = await page.locator('.selection-info-bar').boundingBox();
  const top = selection ? Math.min(selection.y, status!.y) : status!.y;
  const clip = {
    x: 0,
    y: Math.max(0, top - 48),
    width: page.viewportSize()!.width,
    height: page.viewportSize()!.height - Math.max(0, top - 48),
  };
  await page.screenshot({ path: `${outputDir}/${name}.png`, clip });
}

/** Run a registered command through the real command palette. */
async function runPaletteAction(
  page: import('@playwright/test').Page,
  query: string,
  optionName: RegExp,
) {
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.waitFor({ timeout: 30_000 });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await search.fill(query);
  await palette.getByRole('option', { name: optionName }).first().click({ timeout: 15_000 });
  await expect(palette).toBeHidden({ timeout: 10_000 });
}

test.describe('bottom bar visual QA', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300_000);

  test('design row, selected, and unselected, in both themes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await seedLayers(page, 3);

    await setTheme(page, 'light');
    await captureBottomStack(page, 'design-unselected-light');

    await page.getByRole('treeitem').first().click();
    await expect(page.locator('.selection-info-bar')).not.toBeEmpty();
    await captureBottomStack(page, 'design-selected-light');

    await setTheme(page, 'dark');
    await captureBottomStack(page, 'design-selected-dark');

    await setTheme(page, 'high-contrast');
    await captureBottomStack(page, 'design-selected-high-contrast');
  });

  test('print row: preflight and the print-only sections', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await page.keyboard.press('Control+Shift+2');
    // A Design Canvas fixture has no publishing pages or colour config, so
    // page info and colour mode have nothing to render — what this row proves
    // is that Print brings its own sections (preflight) and drops the Design
    // ones, from the same single vocabulary.
    const printTab = page.locator('.workspace-dock__item[aria-label="Print workspace"]');
    await expect(printTab).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
    await expect(
      page.locator('.editor-status').getByRole('button', { name: /Preflight/ }),
    ).toBeVisible();
    await setTheme(page, 'light');
    await captureBottomStack(page, 'print-row-light');
  });

  test('rotated view shows one chip carrying the angle and the reset', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await runPaletteAction(page, 'Rotate View Clockwise', /Rotate View Clockwise/);
    const rotation = page.getByRole('button', { name: /Reset view rotation/ });
    await expect(rotation).toBeVisible({ timeout: 15_000 });
    await expect(rotation).toContainText('°');
    await captureBottomStack(page, 'rotation-chip-light');
    await rotation.click();
    await expect(page.getByRole('button', { name: /Reset view rotation/ })).toHaveCount(0);
  });

  test('narrow row drops its tiers instead of clipping', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    // No layers: at 640px the Layers panel is a drawer, so seeding would be
    // fighting the responsive layout for a capture that is about the row.
    await setTheme(page, 'light');
    await expect(page.locator('.editor-status')).toBeVisible();
    await captureBottomStack(page, 'narrow-640-light');
  });

  test('customize dialog describes the whole row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await runPaletteAction(page, 'Customize Workspace', /^Customize Workspace$/);
    const dialog = page.getByRole('dialog', { name: /Customize Design workspace/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('heading', { name: 'Status Bar Sections' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${outputDir}/customize-status-sections.png` });
    await dialog.getByRole('button', { name: 'Done' }).click();
  });
});
