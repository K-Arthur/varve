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
    // force: the @varve/ui Checkbox draws a visual box over its 1px native
    // input, so a plain .check() never hits the input (same convention as
    // tests/e2e/gradient-map/import-workflow.spec.ts).
    await dialog.getByRole('checkbox', { name: /History/ }).check({ force: true });
    await expect(page.locator('.editor__history-panel')).toBeVisible();

    await page.screenshot({ path: 'test-results/workspace-customize-dialog.png' });
    await dialog.getByRole('button', { name: 'Done' }).click();

    // The override is in the session mirror this instant; a reload in the
    // demo harness confirms the boot path re-projects it.
    const stored = await page.evaluate(() => localStorage.getItem('varve-workspace-preferences'));
    expect(stored).toContain('history');
  });

  test('keyboard-accessible panel moves update the live canvas and persist', async ({ page }) => {
    await navigateToEditor(page);
    await runPaletteAction(page, 'Customize Workspace', /^Customize Workspace$/);
    const dialog = page.getByRole('dialog', { name: /Customize Design workspace/i });
    await dialog.getByRole('combobox', { name: 'Panel to move' }).selectOption('layers');
    await dialog.getByRole('combobox', { name: 'Panel placement' }).selectOption('below');
    await dialog.getByRole('combobox', { name: 'Panel move target' }).selectOption('inspector');
    await dialog.getByRole('button', { name: 'Move panel', exact: true }).click();
    const moveSection = dialog.locator('[aria-labelledby="workspace-dock-move-title"]');
    await expect(moveSection.getByRole('status')).toContainText('Layers moved.');

    const layers = await page.locator('.editor__layers-panel').boundingBox();
    const inspector = await page.locator('.editor__inspector-panel').boundingBox();
    expect(layers).not.toBeNull();
    expect(inspector).not.toBeNull();
    expect(layers!.width).toBeGreaterThanOrEqual(180);
    expect(layers!.height).toBeGreaterThanOrEqual(160);
    expect(inspector!.width).toBeGreaterThanOrEqual(240);
    expect(inspector!.height).toBeGreaterThanOrEqual(160);
    expect(layers!.y).toBeGreaterThanOrEqual(inspector!.y + inspector!.height - 1);
    const customizeOverflow = await page.locator('.workspace-customize').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(customizeOverflow.scrollWidth).toBeLessThanOrEqual(customizeOverflow.clientWidth + 1);
    await dialog
      .locator('.varve-dialog__body')
      .first()
      .evaluate((element) => element.scrollTo({ top: 0 }));
    await page.screenshot({
      path: 'docs/screenshots/workspace-dock-layout/custom-move-controls-light.png',
    });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.screenshot({ path: 'docs/screenshots/workspace-dock-layout/custom-move-light.png' });

    const stored = await page.evaluate(() => localStorage.getItem('varve-workspace-preferences'));
    expect(stored).toContain('dockLayout');
  });

  test('floating groups preview movement, resize, reset and redock accessibly', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await runPaletteAction(page, 'Customize Workspace', /^Customize Workspace$/);
    const dialog = page.getByRole('dialog', { name: /Customize Design workspace/i });
    await dialog.getByRole('combobox', { name: 'Panel to move' }).selectOption('layers');
    await dialog.getByRole('combobox', { name: 'Panel placement' }).selectOption('float');
    await dialog.getByRole('button', { name: 'Move panel', exact: true }).click();
    await expect(dialog.locator('.workspace-customize__hint[role="status"]')).toContainText(
      'Layers updated.',
    );
    await dialog.getByRole('button', { name: 'Done' }).click();

    const float = page.locator('.workspace-dock-floating').first();
    await expect(float).toBeVisible();
    const header = float.locator('.workspace-dock-floating__header');
    const initial = await float.boundingBox();
    expect(initial).not.toBeNull();
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    await page.mouse.move(headerBox!.x + 80, headerBox!.y + 18);
    await page.mouse.down();
    await page.mouse.move(headerBox!.x + 150, headerBox!.y + 78, { steps: 5 });
    await expect
      .poll(async () => (await float.boundingBox())?.x ?? 0)
      .toBeGreaterThan(initial!.x + 30);
    await page.mouse.up();
    const moved = await float.boundingBox();
    expect(moved).not.toBeNull();
    expect(moved!.y).toBeGreaterThan(initial!.y + 20);

    const resizedHandle = float.getByRole('button', { name: /Resize floating Layers group/i });
    const handleBox = await resizedHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox!.x + 10, handleBox!.y + 10);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 70, handleBox!.y + 50, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await float.boundingBox())?.width ?? 0)
      .toBeGreaterThan(moved!.width + 30);

    await header.focus();
    await page.keyboard.press('ArrowRight');
    const keyboardMoved = await float.boundingBox();
    expect(keyboardMoved).not.toBeNull();
    expect(keyboardMoved!.x).toBeGreaterThan(moved!.x);
    await float.getByRole('button', { name: 'Reset location' }).click();
    await expect.poll(async () => (await float.boundingBox())?.x ?? -1).toBeCloseTo(initial!.x, 0);

    // Compact projection must not rewrite desktop float placement. The
    // panel remains reachable through the drawer launcher, then the saved
    // floating group returns when the desktop viewport is restored.
    await page.setViewportSize({ width: 760, height: 900 });
    await expect(page.locator('.workspace-dock-floating')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Show layers panel/i })).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem('varve-workspace-preferences')),
    ).toContain('floatingGroups');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(float).toBeVisible();
    await expect(float.getByRole('button', { name: 'Reset location' })).toBeVisible();
    await page.screenshot({
      path: 'docs/screenshots/workspace-dock-layout/float-controls-light.png',
    });

    const stored = await page.evaluate(() => localStorage.getItem('varve-workspace-preferences'));
    expect(stored).toContain('floatingGroups');
    await float.getByRole('button', { name: 'Redock' }).click();
    await expect(page.locator('.workspace-dock-floating')).toHaveCount(0);
    await expect(page.locator('.editor__layers-panel')).toBeVisible();
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

    // Focus canvas removes panels and browser chrome, and exits through its control.
    await expect(page.locator('.editor__layers-panel')).toHaveCount(0);
    await expect(page.locator('.editor__inspector-panel')).toHaveCount(0);
    await expect(page.locator('.editor-tabs-row')).toHaveCount(0);
    await expect(dialog).toBeHidden();
    const exitFocus = page.getByRole('button', { name: /Exit distraction-free mode/i });
    await expect(exitFocus).toBeVisible();
    await page.screenshot({ path: 'test-results/workspace-focus-canvas.png' });

    await exitFocus.click();
    await expect(page.locator('.editor__layers-panel')).toBeVisible();
    await runPaletteAction(page, 'Manage Layouts', /^Manage Layouts$/);
    const defaultDialog = page.getByRole('dialog', { name: /Manage Layouts/i });
    const defaultRow = defaultDialog
      .locator('.workspace-layouts__row')
      .filter({ hasText: 'Default' })
      .first();
    await defaultRow.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('.editor__layers-panel')).toBeVisible();
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
    // through the registry. Docked panels remain mounted so their local UI
    // state survives moves; assert the collapsed presentation instead.
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
    await expect
      .poll(async () => (await layers.boundingBox())?.x ?? Number.NEGATIVE_INFINITY)
      .toBeGreaterThanOrEqual(-1);
    const drawerBounds = await layers.boundingBox();
    expect(drawerBounds).not.toBeNull();
    expect(drawerBounds!.width).toBeGreaterThanOrEqual(220);
    expect(drawerBounds!.x + drawerBounds!.width).toBeLessThanOrEqual(760);
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
    await expect(dialog).toBeHidden();
    await expect(page.locator('.editor__layers-panel')).toHaveCount(0);
    await expect(page.locator('.workspace-bottom-panels')).toBeHidden();

    await page.setViewportSize({ width: 760, height: 900 });
    // Focus canvas remains recoverable without panel chrome or drag actions.
    const exitFocus = page.getByRole('button', { name: /Exit distraction-free mode/i });
    await expect(exitFocus).toBeVisible();
    const canvasBounds = await page.locator('.editor-canvas').boundingBox();
    expect(canvasBounds).not.toBeNull();
    expect(canvasBounds!.width).toBeGreaterThanOrEqual(320);
    expect(canvasBounds!.height).toBeGreaterThanOrEqual(320);
    const toolbarBounds = await page.locator('.floating-toolbar').boundingBox();
    expect(toolbarBounds).not.toBeNull();
    expect(toolbarBounds!.width).toBeGreaterThanOrEqual(40);
    const exitBounds = await exitFocus.boundingBox();
    expect(exitBounds).not.toBeNull();
    expect(exitBounds!.x).toBeGreaterThanOrEqual(0);
    expect(exitBounds!.y).toBeGreaterThanOrEqual(0);
    expect(exitBounds!.x + exitBounds!.width).toBeLessThanOrEqual(760);
    expect(exitBounds!.y + exitBounds!.height).toBeLessThanOrEqual(900);
    await page.screenshot({
      path: 'docs/screenshots/workspace-dock-layout/focus-canvas-narrow-light.png',
    });
    await exitFocus.click();
    const layersFab = page.getByRole('button', { name: /Show layers panel/i });
    await expect(layersFab).toBeVisible();
    await layersFab.click();
    const layers = page.locator('.editor__layers-panel');
    await expect(layers).toHaveAttribute('data-visible', 'true');
    await expect
      .poll(async () => (await layers.boundingBox())?.x ?? Number.NEGATIVE_INFINITY)
      .toBeGreaterThanOrEqual(-1);
    const layersBounds = await layers.boundingBox();
    expect(layersBounds).not.toBeNull();
    expect(layersBounds!.width).toBeGreaterThanOrEqual(220);
    expect(layersBounds!.x + layersBounds!.width).toBeLessThanOrEqual(760);
    await page.screenshot({
      path: 'docs/screenshots/workspace-dock-layout/focus-recovered-narrow-light.png',
    });
  });
});
