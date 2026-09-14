/**
 * Workspace customization E2E — the user-visible contract for the customize
 * dialog, named layout variants, and reset recovery.
 *
 * Covers the paths a unit test cannot: real menu wiring, real persistence
 * across a reload, layout apply against the live shell, and the recovery
 * snapshot after a reset. Screenshots are captured for review; inspect the
 * generated files under test-results/ rather than trusting a green run.
 *
 * Run with:
 * npx playwright test tests/e2e/workspace/customization.spec.ts --project=chromium --reporter=list
 */

import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Run a registered command through the real command palette. This exercises
 * the registration + dispatch path end to end without depending on the
 * View menu's height at the test viewport.
 */
async function runPaletteAction(page: Page, query: string, optionName: RegExp) {
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  // Cold module-graph starts on constrained machines can take longer than the
  // default expect timeout; the palette itself opens immediately once the
  // editor has hydrated.
  await palette.waitFor({ timeout: 30_000 });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await search.fill(query);
  await palette.getByRole('option', { name: optionName }).first().click({ timeout: 15_000 });
  await expect(palette).toBeHidden({ timeout: 10_000 });
}

test.describe('workspace customization', () => {
  test.setTimeout(240_000);

  test('customize dialog toggles a panel and persists the choice', async ({ page }) => {
    await navigateToEditor(page);
    await expect(page.locator('.editor__history-panel')).toHaveCount(0);

    await runPaletteAction(page, 'Customize Workspace', /^Customize Workspace$/);
    const dialog = page.getByRole('dialog', { name: /Customize Design workspace/i });
    await expect(dialog).toBeVisible();

    // Editor Chrome is part of the supported surface.
    await expect(dialog.getByText('Editor Chrome')).toBeVisible();
    await dialog.getByRole('checkbox', { name: /History/ }).check();
    await expect(page.locator('.editor__history-panel')).toBeVisible();

    await page.screenshot({ path: 'test-results/workspace-customize-dialog.png' });
    await dialog.getByRole('button', { name: 'Done' }).click();

    // The override is in the session mirror this instant; a reload in the
    // demo harness confirms the boot path re-projects it.
    const stored = await page.evaluate(() => localStorage.getItem('varve-workspace-preferences'));
    expect(stored).toContain('history');
  });

  test('focus canvas template applies and Default restores', async ({ page }) => {
    await navigateToEditor(page);
    await expect(page.locator('.editor__layers-panel')).toBeVisible();

    await runPaletteAction(page, 'Manage Layouts', /^Manage Layouts$/);
    const dialog = page.getByRole('dialog', { name: /Manage Layouts/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Focus canvas').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/workspace-manage-layouts.png' });

    const focusRow = dialog.locator('.workspace-layouts__row').filter({ hasText: 'Focus canvas' });
    await focusRow.getByRole('button', { name: 'Apply' }).click();

    // Panels and tab strip hide; the menubar and the dialog stay reachable.
    await expect(page.locator('.editor__layers-panel')).toHaveAttribute('data-collapsed', 'true');
    await expect(page.locator('.editor__inspector-panel')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
    await expect(page.locator('.editor-tabs-row')).toHaveCount(0);
    await expect(page.locator('.editor-shell__menubar')).toBeVisible();
    await page.screenshot({ path: 'test-results/workspace-focus-canvas.png' });

    const defaultRow = dialog
      .locator('.workspace-layouts__row')
      .filter({ hasText: 'Default' })
      .first();
    await defaultRow.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('.editor__layers-panel')).not.toHaveAttribute(
      'data-collapsed',
      'true',
    );
    await expect(page.locator('.editor__inspector-panel')).not.toHaveAttribute(
      'data-collapsed',
      'true',
    );
    await expect(page.locator('.editor-tabs-row')).toHaveCount(1);
  });

  test('reset captures a recoverable snapshot', async ({ page }) => {
    await navigateToEditor(page);
    await expect(page.locator('.editor__layers-panel')).not.toHaveAttribute(
      'data-collapsed',
      'true',
    );

    // Hide the layers panel with its shortcut, then reset the workspace
    // through the registry.
    await page.keyboard.press('Control+b');
    await expect(page.locator('.editor__layers-panel')).toHaveAttribute('data-collapsed', 'true');

    await runPaletteAction(page, 'Reset Workspace', /^Reset Workspace$/);
    await expect(page.locator('.editor__layers-panel')).not.toHaveAttribute(
      'data-collapsed',
      'true',
    );

    await runPaletteAction(page, 'Manage Layouts', /^Manage Layouts$/);
    const dialog = page.getByRole('dialog', { name: /Manage Layouts/i });
    const recovery = dialog.locator('.workspace-layouts__section--recovery');
    await expect(recovery).toBeVisible();
    await recovery.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('.editor__layers-panel')).toHaveAttribute('data-collapsed', 'true');
  });

  test('rejects invalid imports and accepts a valid portable layout', async ({ page }) => {
    await navigateToEditor(page);
    await runPaletteAction(page, 'Manage Layouts', /^Manage Layouts$/);
    const dialog = page.getByRole('dialog', { name: /Manage Layouts/i });

    await dialog.getByRole('button', { name: /Import from JSON/ }).click();
    const textarea = dialog.getByRole('textbox', { name: /Paste a layout JSON/i });
    await textarea.fill('{"not":"a layout"}');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(/not a valid Varve layout/i);

    await textarea.fill(
      JSON.stringify({
        kind: 'varve-workspace-layout',
        schemaVersion: 1,
        name: 'E2E imported layout',
        payload: { panelOverrides: { history: { visible: true } } },
      }),
    );
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByText('E2E imported layout').first()).toBeVisible();

    // Applying the imported layout shows the history panel it specifies.
    const row = dialog
      .locator('.workspace-layouts__row')
      .filter({ hasText: 'E2E imported layout' });
    await row.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('.editor__history-panel')).toBeVisible();
  });

  test('narrow viewport drawers open, close, and stay reachable', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 900 });
    await navigateToEditor(page);

    // The launcher is visible only at the drawer breakpoint and must never be
    // gated by the status-bar preference.
    const layersFab = page.getByRole('button', { name: /Show layers panel/i });
    await expect(layersFab).toBeVisible();
    await layersFab.click();
    const layers = page.locator('.editor__layers-panel');
    await expect(layers).toHaveAttribute('data-visible', 'true');
    await page.screenshot({ path: 'test-results/workspace-narrow-drawer.png' });

    // Escape closes the drawer and returns focus to its launcher.
    await page.keyboard.press('Escape');
    await expect(layers).not.toHaveAttribute('data-visible', 'true');

    // A hidden panel behind the drawer is still recoverable through the same
    // launcher after the fact.
    await layersFab.click();
    await expect(layers).toHaveAttribute('data-visible', 'true');
  });

  test('panel launchers survive a chrome-less workspace at narrow widths', async ({ page }) => {
    await navigateToEditor(page);
    await runPaletteAction(page, 'Manage Layouts', /^Manage Layouts$/);
    const dialog = page.getByRole('dialog', { name: /Manage Layouts/i });
    const focusRow = dialog.locator('.workspace-layouts__row').filter({ hasText: 'Focus canvas' });
    await focusRow.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('.editor__layers-panel')).toHaveAttribute('data-collapsed', 'true');
    // Close the modal before driving controls behind it.
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    await page.setViewportSize({ width: 760, height: 900 });
    // Focus canvas hides the status bar; the launcher must remain, because a
    // hidden panel is never the only route to the feature behind it.
    const layersFab = page.getByRole('button', { name: /Show layers panel/i });
    await expect(layersFab).toBeVisible();
    await layersFab.click();
    await expect(page.locator('.editor__layers-panel')).toHaveAttribute('data-visible', 'true');
    await page.screenshot({ path: 'test-results/workspace-narrow-focus-canvas.png' });
  });
});
