import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

/**
 * Dialog system contract.
 *
 * These specs drive the real application, not a fixture: each one opens a
 * dialog through its actual entry point and asserts the interaction contract
 * the shared primitives promise (one Escape per layer, backdrop dismissal
 * only on a real backdrop click, focus placement/return, viewport fit).
 *
 * Evidence for docs/audits/dialog-review-2026-09-15.md:
 *  - Escape-in-Select closed the whole Export dialog before the fix.
 *  - A press inside Settings released over the backdrop closed it.
 */

test.describe('Escape layers', () => {
  test('Escape dismisses a nested Select without closing the Export dialog', async ({ page }) => {
    await navigateToEditor(page);

    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page
      .getByRole('menuitem', { name: /^Export\u2026/ })
      .first()
      .click();

    const exportDialog = page.locator('dialog.export-dialog');
    await expect(exportDialog).toBeVisible({ timeout: 10000 });

    const toggle = exportDialog.getByRole('switch', {
      name: /remove background before export/i,
    });
    const checked = await toggle.getAttribute('aria-checked');
    if (checked !== 'true') await toggle.click();

    const method = exportDialog.getByRole('combobox', {
      name: /background removal method/i,
    });
    await method.click();
    await expect(page.getByRole('listbox')).toBeVisible();

    // First Escape: the dropdown only. Regression: this used to close both.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(exportDialog).toBeVisible();

    // Second Escape: the dialog itself.
    await page.keyboard.press('Escape');
    await expect(exportDialog).toBeHidden();
  });
});

test.describe('Settings dialog', () => {
  test('places initial focus on the active section and closes on Escape with focus restored', async ({
    page,
  }) => {
    await navigateToEditor(page);
    // Focus the canvas content layer so the restore target is observable.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.click({ position: { x: 40, y: 40 } });
    await expect(canvas).toBeFocused();

    await page.keyboard.press('Control+,');
    const settings = page.locator('dialog.varve-dialog--settings');
    await expect(settings).toHaveAttribute('open', '');

    const activeTab = settings.locator('[role="tab"][aria-selected="true"]');
    await expect(activeTab).toBeFocused();
    await expect(settings.locator('.varve-dialog__close')).not.toBeFocused();

    await page.keyboard.press('Escape');
    await expect(settings).not.toHaveAttribute('open', '');
    await expect(canvas).toBeFocused();
  });

  test('a press that starts in a field and is released on the backdrop does not close the dialog', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await page.keyboard.press('Control+,');
    const settings = page.locator('dialog.varve-dialog--settings');
    await expect(settings).toHaveAttribute('open', '');

    // Settings > Appearance has theme controls; use the nav search-free first
    // focusable field that exists in every section: the section tab itself.
    const tabBox = (await settings.locator('[role="tab"][aria-selected="true"]').boundingBox())!;
    await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await page.mouse.down();
    // Drag to the top-left backdrop corner and release there.
    await page.mouse.move(6, 6, { steps: 8 });
    await page.mouse.up();

    await expect(settings).toHaveAttribute('open', '');
  });

  test('a plain backdrop click still closes the dialog', async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('Control+,');
    const settings = page.locator('dialog.varve-dialog--settings');
    await expect(settings).toHaveAttribute('open', '');

    await page.mouse.click(6, 6);
    await expect(settings).not.toHaveAttribute('open', '');
  });
});

test.describe('Export dialog at a short viewport', () => {
  test('keeps the action row inside the viewport and scrolls its body', async ({ page }) => {
    await navigateToEditor(page);
    await page.setViewportSize({ width: 900, height: 560 });

    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page
      .getByRole('menuitem', { name: /^Export\u2026/ })
      .first()
      .click();

    const exportDialog = page.locator('.export-dialog');
    await expect(exportDialog).toBeVisible({ timeout: 10000 });
    // The shared dialog fades/scales in over --duration-base; measure the
    // settled surface, not a mid-animation frame.
    await expect(exportDialog).toHaveCSS('opacity', '1');

    const geometry = await exportDialog.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const footer = el.querySelector('[class*="footer"]');
      const body = el.querySelector('[class*="body"]');
      const bodyStyle = body ? getComputedStyle(body) : null;
      const bodyOverflows = body ? body.scrollHeight > body.clientHeight + 1 : false;
      return {
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        hasFooter: footer !== null,
        // A body that overflows must scroll (overflow-y auto/scroll); if the
        // content fits, no scrolling is required. Clipping is the regression.
        bodyClips:
          bodyOverflows &&
          bodyStyle !== null &&
          bodyStyle.overflowY !== 'auto' &&
          bodyStyle.overflowY !== 'scroll',
      };
    });

    expect(geometry.rect.top).toBeGreaterThanOrEqual(0);
    expect(geometry.rect.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(geometry.rect.left).toBeGreaterThanOrEqual(0);
    expect(geometry.rect.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.hasFooter).toBe(true);
    expect(geometry.bodyClips).toBe(false);
  });
});

test.describe('Batch Rename workflow', () => {
  test('renames layers through the context menu and undoes as one entry', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);

    const namesBefore = await page.getByRole('treeitem').allTextContents();

    await page.getByRole('treeitem').first().click({ button: 'right' });
    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: /batch rename/i }).click();

    const dialog = page.locator('dialog[open]').filter({ hasText: 'Batch Rename' });
    await expect(dialog).toBeVisible();

    // The find field is the reason the dialog exists — it must have focus.
    const find = dialog.getByPlaceholder(/Text to find/);
    await expect(find).toBeFocused();

    await find.fill('Rectangle');
    await dialog.getByPlaceholder(/Replacement text/).fill('Card');
    const apply = dialog.getByRole('button', { name: /^Rename All \(/ });
    await expect(apply).toBeEnabled();
    await apply.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('treeitem', { name: /Card/ }).first()).toBeVisible();
    // The context-menu item that opened the dialog unmounted with the menu,
    // so the platform has no invoker to restore focus to; the layer tree is
    // the marked fallback instead of the document body.
    await expect(page.getByRole('tree', { name: 'Layers' }).first()).toBeFocused();
    const namesAfter = await page.getByRole('treeitem').allTextContents();
    expect(namesAfter.join('|')).not.toBe(namesBefore.join('|'));

    // One undo restores every rename (documented history contract).
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem').first()).toHaveText(/Rectangle/);
  });

  test('has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 2);
    await page.getByRole('treeitem').first().click({ button: 'right' });
    await page
      .locator('.varve-ctxmenu')
      .getByRole('menuitem', { name: /batch rename/i })
      .click();
    const dialog = page.locator('dialog[open]').filter({ hasText: 'Batch Rename' });
    await expect(dialog).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('dialog[open]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('Create table from data', () => {
  test('pastes data and creates a table through the toolbar', async ({ page }) => {
    await navigateToEditor(page);

    // Activate the Table tool (it may be collapsed into More tools).
    if ((await page.locator('[data-tool="table"]').count()) === 0) {
      await page.getByRole('button', { name: /more tools/i }).click();
    }
    await page.locator('[data-tool="table"]').first().click();

    const fromData = page.locator('[data-tool="tableFromData"]');
    await expect(fromData).toBeVisible({ timeout: 5000 });
    await fromData.click();

    const dialog = page.locator('dialog[open]').filter({ hasText: 'Create table from data' });
    await expect(dialog).toBeVisible();

    const paste = dialog.getByLabel(/paste csv/i);
    await expect(paste).toBeFocused();
    await paste.fill('name,qty\nWidget,4\nGadget,7');
    await expect(dialog.getByText('3 rows x 2 columns')).toBeVisible();

    await dialog.getByRole('button', { name: /create table/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('treeitem', { name: /Table/ }).first()).toBeVisible();
  });
});

test.describe('visual evidence', () => {
  test('captures Batch Rename and Settings in light and dark themes', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);

    await page.getByRole('treeitem').first().click({ button: 'right' });
    await page
      .locator('.varve-ctxmenu')
      .getByRole('menuitem', { name: /batch rename/i })
      .click();
    const dialog = page.locator('dialog[open]').filter({ hasText: 'Batch Rename' });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder(/Text to find/).fill('Rectangle');
    await dialog.getByPlaceholder(/Replacement text/).fill('Card');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'reports/dialog-audit/batch-rename-light.png' });

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'reports/dialog-audit/batch-rename-dark.png' });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.keyboard.press('Control+,');
    const settings = page.locator('dialog.varve-dialog--settings');
    await expect(settings).toHaveAttribute('open', '');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'reports/dialog-audit/settings-dark.png' });

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'reports/dialog-audit/settings-light.png' });

    await page.keyboard.press('Escape');
    await expect(settings).not.toHaveAttribute('open', '');

    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page
      .getByRole('menuitem', { name: /^Export\u2026/ })
      .first()
      .click();
    const exportDialog = page.locator('dialog.export-dialog');
    await expect(exportDialog).toBeVisible({ timeout: 10000 });
    await expect(exportDialog).toHaveCSS('opacity', '1');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'reports/dialog-audit/export-light.png' });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'reports/dialog-audit/export-dark.png' });
  });
});
