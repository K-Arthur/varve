import { expect, test } from '@playwright/test';
import { openSubmenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

test.describe('Document fonts panel', () => {
  test('shows page-scoped usage and remains readable in a narrow dark inspector', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const editorShell = page.locator('.editor-shell:visible');
    const toolbarRoot = page.getByTestId('toolbar');
    if ((await editorShell.count()) === 0) {
      const recentFile = page.getByRole('gridcell').first();
      if (await recentFile.isVisible({ timeout: 1500 }).catch(() => false)) {
        await recentFile.click({ timeout: 10000 });
        await editorShell.waitFor({ state: 'visible', timeout: 60000 });
      }
    }
    await editorShell.waitFor({ state: 'visible', timeout: 60000 });
    await toolbarRoot.waitFor({ state: 'visible', timeout: 60000 });
    // IndexedDB can finish its hand-off after the first shell appears and
    // return the route to Home. Re-open the newest document while that
    // transition settles instead of sending editor actions to a stale shell.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.waitForTimeout(500);
      if (
        await page
          .getByRole('menubar')
          .isVisible({ timeout: 1000 })
          .catch(() => false)
      )
        break;
      const recentFile = page.getByRole('gridcell').first();
      if (!(await recentFile.isVisible({ timeout: 1000 }).catch(() => false))) continue;
      await recentFile.click({ timeout: 10000 });
      await page.getByRole('menubar').waitFor({ state: 'visible', timeout: 60000 });
    }
    await expect(page.getByRole('menubar')).toBeVisible({ timeout: 10000 });
    // The panel toggles live in the View > Panels submenu now that the View
    // root is grouped to fit one screen.
    const panels = await openSubmenu(page, 'View', 'Panels');
    await panels.getByRole('menuitem', { name: /^Fonts Panel/ }).click();
    const panel = page.locator('.document-fonts-panel').first();
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Use the rendered tool action so the test does not depend on whichever
    // element retained focus after startup.
    const textTool = toolbarRoot.locator('[data-tool="text"]');
    if (await textTool.isVisible({ timeout: 1500 }).catch(() => false)) {
      await textTool.click({ timeout: 15000 });
    } else {
      await page
        .getByRole('toolbar', { name: 'Contextual properties' })
        .getByRole('button', {
          name: 'Add text',
        })
        .click({ timeout: 15000 });
    }
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();
    const canvasBounds = await canvas.boundingBox();
    if (!canvasBounds) throw new Error('Canvas has no bounds');
    // Dragging creates an area-text target and enters the same editing state
    // as a user gets when they size a text box.
    await page.mouse.move(canvasBounds.x + 120, canvasBounds.y + 160);
    await page.mouse.down();
    await page.mouse.move(canvasBounds.x + 360, canvasBounds.y + 220);
    await page.mouse.up();
    await page.keyboard.insertText('Document font replacement');
    const textToolbar = page.getByRole('toolbar', { name: 'Text formatting' });
    if (!(await textToolbar.isVisible({ timeout: 1000 }).catch(() => false))) {
      const edit = page.getByRole('button', { name: 'Edit text', exact: true }).first();
      await edit.waitFor({ state: 'visible', timeout: 15000 });
      await edit.click({ timeout: 15000 });
    }
    await expect(textToolbar).toBeVisible({ timeout: 15000 });

    await expect(panel.getByRole('heading', { name: 'Document fonts' })).toBeVisible();
    await expect(panel.getByRole('tab', { name: /Page|canvas/i })).toBeVisible();
    await expect(panel.getByText(/face[s]? in/)).toBeVisible();

    const replaceButton = panel.getByRole('button', { name: /^Replace / }).first();
    await expect(replaceButton).toBeVisible();
    await replaceButton.click();
    const replacementDialog = page.getByRole('dialog', { name: 'Browse fonts' });
    await expect(replacementDialog).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Review wrapping after replacement/)).toBeVisible();
    const originalFamily = await panel
      .locator('.document-fonts-panel__row strong')
      .first()
      .textContent();
    expect(originalFamily?.trim()).toBeTruthy();
    // A prior renderer warning can leave the consent-gated crash dialog in
    // the top layer while the font dialog is still mounted. Dismiss that
    // unrelated recovery surface so the capture reflects the font workflow.
    const recovery = page.locator('dialog.crash-dialog[open]');
    if (await recovery.isVisible({ timeout: 1000 }).catch(() => false)) {
      await recovery
        .getByRole('button', { name: /review my documents/i })
        .click({ force: true, timeout: 5000 });
      await expect(recovery).toBeHidden({ timeout: 5000 });
    }
    await page.screenshot({
      path: testInfo.outputPath('document-fonts-replacement-chooser.png'),
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(replacementDialog).toBeHidden();

    // Exercise the real replacement transaction, then verify that one Undo
    // restores the original family and one Redo reapplies the replacement.
    // This catches a stale panel projection or a transaction split that unit
    // tests cannot observe through the editor history and canvas surface.
    await replaceButton.click();
    await expect(replacementDialog).toBeVisible({ timeout: 10000 });
    const replacementSearch = replacementDialog.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    // Keep the replacement local and deterministic: the bundled tab contains
    // the two variable families shipped with the editor, while the default
    // search catalog also includes hundreds of downloadable semantic matches.
    await replacementSearch.fill('');
    await replacementDialog.getByRole('tab', { name: 'Bundled', exact: true }).click();
    const replacementFamily = replacementDialog
      .locator('.font-browser__select-btn')
      .filter({ hasText: /Geist Variable|Fraunces Variable/ })
      .first();
    await expect(replacementFamily).toBeVisible({ timeout: 10000 });
    const replacementName = (
      (await replacementFamily.locator('.font-browser__preview').textContent()) ?? ''
    ).trim();
    expect(['Geist Variable', 'Fraunces Variable']).toContain(replacementName);
    await replacementFamily.click();
    const useFont = replacementDialog.locator('button.font-browser__use-btn');
    await expect(useFont).toBeEnabled({ timeout: 10000 });
    await useFont.click();
    await expect(replacementDialog).toBeHidden({ timeout: 10000 });
    await expect(
      panel.locator('.document-fonts-panel__row').filter({ hasText: replacementName }),
    ).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('Control+z');
    await expect(
      panel.locator('.document-fonts-panel__row').filter({ hasText: originalFamily?.trim() ?? '' }),
    ).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Control+Shift+z');
    await expect(
      panel.locator('.document-fonts-panel__row').filter({ hasText: replacementName }),
    ).toBeVisible({ timeout: 10000 });

    // The replacement provenance remains actionable after redo. Confirming
    // Restore is a separate transaction and returns the exact original row.
    const restoreButton = panel.getByRole('button', { name: /^Restore original / });
    await expect(restoreButton).toBeVisible({ timeout: 10000 });
    await restoreButton.click();
    await expect(page.getByRole('heading', { name: 'Restore original font?' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore original', exact: true }).click();
    await expect(
      panel.locator('.document-fonts-panel__row').filter({ hasText: originalFamily?.trim() ?? '' }),
    ).toBeVisible({ timeout: 10000 });

    // Leave text creation before switching to the narrow inspector capture;
    // otherwise the Text tool's defaults popover can cover the document-font
    // surface and make the screenshot test the wrong layer.
    const selectTool = toolbarRoot.locator('[data-tool="select"]');
    if (await selectTool.isVisible({ timeout: 1500 }).catch(() => false)) {
      await selectTool.click({ timeout: 5000 });
    }

    await page.setViewportSize({ width: 560, height: 760 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    const showInspector = page.getByRole('button', { name: 'Show inspector panel' });
    if (await showInspector.isVisible({ timeout: 1500 }).catch(() => false)) {
      await showInspector.click({ timeout: 5000 });
    }
    await expect(panel).toBeVisible({ timeout: 10000 });
    const gotIt = page.getByRole('button', { name: 'Got it', exact: true });
    if (await gotIt.isVisible({ timeout: 1000 }).catch(() => false)) {
      await gotIt.click({ force: true, timeout: 5000 });
    }
    await page.mouse.move(20, 20);
    const panelBounds = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        right: rect.right,
        viewport: window.innerWidth,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(panelBounds.right).toBeLessThanOrEqual(panelBounds.viewport + 1);
    expect(panelBounds.scrollWidth).toBeLessThanOrEqual(panelBounds.clientWidth + 1);
    await page.screenshot({
      path: testInfo.outputPath('document-fonts-narrow-dark.png'),
      fullPage: true,
    });
  });
});
