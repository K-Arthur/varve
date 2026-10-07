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
import { evidencePath } from '../helpers/evidence-output';
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
    // The native input is clipped to 1px and has a negative margin. Click its
    // visible label with normal actionability checks, as a pointer user does.
    const panels = [
      { name: 'History', selector: '.editor__history-panel' },
      { name: 'Timeline', selector: '.timeline-panel' },
    ];
    for (const { name, selector } of panels) {
      const toggle = dialog.getByRole('checkbox', { name, exact: true });
      await expect(toggle).not.toBeChecked();
      await dialog.getByText(name, { exact: true }).click();
      await expect(toggle).toBeChecked();
      await expect(page.locator(selector)).toBeVisible();
    }

    await page.screenshot({ path: evidencePath('workspace-customize-dialog.png') });
    await dialog.getByRole('button', { name: 'Done' }).click();

    // Check the session mirror, then navigate through a new page load and
    // create another document to exercise preference restoration at boot.
    const stored = await page.evaluate(() => localStorage.getItem('varve-workspace-preferences'));
    expect(stored).toContain('history');
    await navigateToEditor(page);
    for (const { selector } of panels) await expect(page.locator(selector)).toBeVisible();
    await page.screenshot({ path: evidencePath('workspace-customize-restored.png') });
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
      path: evidencePath('workspace-dock-layout/custom-move-controls-light.png'),
    });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.screenshot({ path: evidencePath('workspace-dock-layout/custom-move-light.png') });

    const stored = await page.evaluate(() => localStorage.getItem('varve-workspace-preferences'));
    expect(stored).toContain('dockLayout');
  });

  test('panel location controls fit compact and small-laptop viewports', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 768 });
    await navigateToEditor(page);
    await runPaletteAction(page, 'Customize Workspace', /^Customize Workspace$/);
    const dialog = page.getByRole('dialog', { name: /Customize Design workspace/i });
    const row = dialog.locator('.workspace-customize__arrangement-row--dock-move');
    await expect(row).toBeVisible();

    for (const viewport of [
      { width: 760, height: 768 },
      { width: 800, height: 768 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await page.evaluate(() => {
        const rect = (element: Element | null) => {
          const box = element?.getBoundingClientRect();
          return box
            ? {
                x: box.x,
                y: box.y,
                right: box.right,
                bottom: box.bottom,
                width: box.width,
                height: box.height,
              }
            : null;
        };
        const dialog = document.querySelector('dialog.varve-dialog--workspace-customize');
        const moveRow = document.querySelector('.workspace-customize__arrangement-row--dock-move');
        const controls = moveRow
          ? [...moveRow.querySelectorAll<HTMLElement>('.varve-native-select, .varve-btn')]
          : [];
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          dialog: rect(dialog),
          moveRow: rect(moveRow),
          controls: controls.map((element) => ({
            label: element.getAttribute('aria-label') ?? element.innerText,
            rect: rect(element),
          })),
          columns: moveRow ? getComputedStyle(moveRow).gridTemplateColumns : '',
        };
      });

      expect(geometry.documentWidth, `${viewport.width}px document overflow`).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(geometry.dialog, `${viewport.width}px dialog missing`).not.toBeNull();
      expect(geometry.moveRow, `${viewport.width}px move row missing`).not.toBeNull();
      expect(geometry.controls, `${viewport.width}px controls missing`).toHaveLength(4);
      expect(geometry.dialog!.x).toBeGreaterThanOrEqual(0);
      expect(geometry.dialog!.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(geometry.moveRow!.x).toBeGreaterThanOrEqual(geometry.dialog!.x);
      expect(geometry.moveRow!.right).toBeLessThanOrEqual(geometry.dialog!.right);
      const rowBox = geometry.moveRow!;
      const controlBoxes = geometry.controls.map(({ rect: controlBox }) => {
        expect(controlBox, `${viewport.width}px control has no box`).not.toBeNull();
        return controlBox!;
      });
      for (const [index, box] of controlBoxes.entries()) {
        expect(box.x, `${viewport.width}px control ${index} clips left`).toBeGreaterThanOrEqual(
          rowBox.x - 1,
        );
        expect(box.right, `${viewport.width}px control ${index} clips right`).toBeLessThanOrEqual(
          rowBox.right + 1,
        );
        for (const other of controlBoxes.slice(index + 1)) {
          const intersects =
            box.x < other.right &&
            box.right > other.x &&
            box.y < other.bottom &&
            box.bottom > other.y;
          expect(intersects, `${viewport.width}px move controls overlap`).toBe(false);
        }
      }

      if (viewport.width <= 899) {
        expect(
          controlBoxes.every((box) => Math.abs(box.x - rowBox.x) < 1),
          `${viewport.width}px move controls should stack to a single column`,
        ).toBe(true);
        expect(controlBoxes[3]!.width).toBeGreaterThan(controlBoxes[0]!.width - 1);
      }

      if (viewport.width === 760 || viewport.width === 1280) {
        await page.screenshot({
          path: evidencePath(`workspace-dock-layout/panel-move-${viewport.width}.png`),
        });
      }
    }
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
    const title = float.locator('.workspace-dock-floating__title');
    const initial = await float.boundingBox();
    expect(initial).not.toBeNull();
    const headerBox = await title.boundingBox();
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
    const floatingLayers = page.locator('.editor__layers-panel');
    const layersBox = await floatingLayers.boundingBox();
    expect(layersBox).not.toBeNull();
    expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(layersBox!.y + 1);

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
    await expect.poll(async () => (await float.boundingBox())?.x ?? -1).toBeCloseTo(moved!.x, 0);

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
    await expect(
      float.getByRole('button', { name: /Resize floating Layers group/i }),
    ).toBeVisible();
    await page.screenshot({
      path: evidencePath('workspace-dock-layout/float-controls-light.png'),
    });

    const stored = await page.evaluate(() => localStorage.getItem('varve-workspace-preferences'));
    expect(stored).toContain('floatingGroups');
    await float.getByRole('button', { name: 'Redock' }).click();
    await expect(page.locator('.workspace-dock-floating')).toHaveCount(0);
    await expect(page.locator('.editor__layers-panel')).toBeVisible();
  });

  test('floating actions stay clear of Inspector controls and do not steal their clicks', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await runPaletteAction(page, 'Customize Workspace', /^Customize Workspace$/);
    const dialog = page.getByRole('dialog', { name: /Customize Design workspace/i });
    await dialog.getByRole('combobox', { name: 'Panel to move' }).selectOption('inspector');
    await dialog.getByRole('combobox', { name: 'Panel placement' }).selectOption('float');
    await dialog.getByRole('button', { name: 'Move panel', exact: true }).click();
    await expect(dialog.locator('.workspace-customize__hint[role="status"]')).toContainText(
      'Inspector updated.',
    );
    await dialog.getByRole('button', { name: 'Done' }).click();

    const floatingGroup = page.locator('.workspace-dock-floating').filter({
      has: page.locator('.workspace-dock-floating__title', { hasText: 'Inspector' }),
    });
    const header = floatingGroup.locator('.workspace-dock-floating__header');
    const inspector = page.locator('#editor-inspector-panel');
    await expect(floatingGroup).toBeVisible();
    await expect(inspector).toBeVisible();

    const headerBox = await header.boundingBox();
    const panelBox = await inspector.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);

    for (const name of ['Reset location', 'Redock', 'Resize floating Inspector group']) {
      const control = floatingGroup.getByRole('button', { name, exact: true });
      await expect(control).toBeVisible();
      const controlBox = await control.boundingBox();
      expect(controlBox).not.toBeNull();
      expect(controlBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
      expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(
        headerBox!.y + headerBox!.height + 1,
      );
    }

    const propertiesTab = inspector.getByRole('tab', { name: 'Design', exact: true });
    const exportTab = inspector.getByRole('tab', { name: 'Export', exact: true });
    for (const tab of [propertiesTab, exportTab]) {
      const tabBox = await tab.boundingBox();
      expect(tabBox).not.toBeNull();
      expect(tabBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
      const receivesPointer = await tab.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return target === element || (target instanceof Node && element.contains(target));
      });
      expect(receivesPointer).toBe(true);
    }

    // Exercise actual Inspector controls under the floating action chrome.
    await exportTab.click();
    await expect(exportTab).toHaveAttribute('aria-selected', 'true');
    await propertiesTab.click();
    await expect(propertiesTab).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({
      path: evidencePath('workspace-dock-layout/float-inspector-controls-light.png'),
      animations: 'disabled',
    });
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
      path: evidencePath('workspace-dock-layout/focus-canvas-narrow-light.png'),
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
      path: evidencePath('workspace-dock-layout/focus-recovered-narrow-light.png'),
    });
  });
});
