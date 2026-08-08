/**
 * End-to-end panel detach flow (browser popup transport).
 *
 * Proves the complete workflow in a real browser:
 * 1. Open editor, create a document with a shape
 * 2. Detach the Layers panel (click detach button)
 * 3. A real popup window opens and renders the ACTUAL Layers panel
 * 4. The source panel disappears from the main window
 * 5. Renaming a layer in the popup updates the main window's document
 *    (single document authority; undo lives in the primary)
 * 6. Reattach closes the popup and the panel returns
 *
 * Run: npx playwright test tests/e2e/workspace/detach.spec.ts --project=chromium --workers=1
 */

import { expect, type Page, test } from '@playwright/test';

async function navigateToEditor(page: Page): Promise<void> {
  await page.goto('/', { timeout: 180_000, waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem(
      'strata:onboarding',
      JSON.stringify({
        onboardingComplete: true,
        checklistProgress: ['shape', 'color', 'text', 'group', 'export'],
      }),
    );
  });
  await page
    .getByRole('button', { name: /^new$/i })
    .waitFor({ state: 'visible', timeout: 180_000 });
  await page.getByRole('button', { name: /^new$/i }).click({ timeout: 30_000 });
  const dialog = page.locator('dialog[open]');
  const createBtn = dialog.getByRole('button', { name: /^create design$/i });
  if (await createBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await createBtn.click({ timeout: 30_000 });
  }
  await page.locator('.layers-panel').waitFor({ timeout: 180_000 });
}

test.describe
  .serial('panel detach flow', () => {
    test('detach → popup renders real panel → source hides → sync → reattach', async ({
      page,
      context,
    }) => {
      await navigateToEditor(page);

      // Add a shape so the layer tree has a renamable layer (drag on the
      // canvas with the rect tool, matching the shared E2E helper pattern).
      await page.keyboard.press('r');
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      await canvas.waitFor({ state: 'attached', timeout: 15000 });
      const box = await canvas.boundingBox();
      if (!box) throw new Error('canvas not found');
      await page.mouse.move(box.x + 150, box.y + 150);
      await page.mouse.down();
      await page.mouse.move(box.x + 350, box.y + 350, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const mainLayerRow = page.locator('.layers-row').first();
      await expect(mainLayerRow).toBeVisible({ timeout: 30_000 });

      // 1. Click detach on the Layers panel.
      const detachBtn = page.locator('[data-testid="detach-layers"]');
      await expect(detachBtn).toBeVisible({ timeout: 30_000 });

      const popupPromise = context.waitForEvent('page', { timeout: 60_000 });
      await detachBtn.click();
      const popup = await popupPromise;

      // 2. The popup renders the REAL layers panel with the same layer tree.
      await expect(popup.locator('.layers-panel')).toBeVisible({ timeout: 90_000 });
      await expect(popup.locator('.layers-panel__header')).toBeVisible({ timeout: 30_000 });
      await expect(popup.locator('.layers-row').first()).toBeVisible({ timeout: 30_000 });

      // 3. The source Layers panel is hidden in the main window.
      await expect(page.locator('.editor__layers-panel .layers-panel')).toBeHidden({
        timeout: 30_000,
      });

      // 4. Mutation sync: rename the layer in the POPUP (aux-doc-changed →
      //    primary updateDoc — single document authority).
      await popup.locator('.layers-row').first().dblclick({ timeout: 30_000 });
      const renameInput = popup.locator('.layers-row__name-input').first();
      await expect(renameInput).toBeVisible({ timeout: 15_000 });
      await renameInput.fill('Renamed From Popup');
      await renameInput.press('Enter');

      // 5. Reattach: popup closes, panel returns to the main window.
      await popup.locator('[data-testid="reattach-panel"]').click();
      await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
      await expect(page.locator('.editor__layers-panel .layers-panel')).toBeVisible({
        timeout: 30_000,
      });

      // 6. Sync proof: the rename made in the popup lives in the PRIMARY
      //    document — the reattached panel shows it.
      await expect(page.locator('.layers-row').first()).toContainText('Renamed From Popup', {
        timeout: 30_000,
      });
    });

    test('multi-panel window + cross-window undo', async ({ page, context }) => {
      await navigateToEditor(page);

      // Draw a rect so the layer tree has a row.
      await page.keyboard.press('r');
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('canvas not found');
      await page.mouse.move(box.x + 150, box.y + 150);
      await page.mouse.down();
      await page.mouse.move(box.x + 350, box.y + 350, { steps: 4 });
      await page.mouse.up();
      await expect(page.locator('.layers-row').first()).toBeVisible({ timeout: 30_000 });

      // Detach Layers into a new window.
      const popupPromise1 = context.waitForEvent('page', { timeout: 60_000 });
      await page.locator('[data-testid="detach-layers"]').click({ timeout: 15_000 });
      const popup1 = await popupPromise1;
      await expect(popup1.locator('.layers-panel')).toBeVisible({ timeout: 90_000 });

      // Detach Inspector — the menu offers "move into the existing window".
      const inspectorDetach = page.locator('[data-testid="detach-inspector"]');
      await expect(inspectorDetach).toBeVisible({ timeout: 30_000 });
      await inspectorDetach.click({ timeout: 15_000 });
      const menu = page.locator('[data-testid="detach-menu-inspector"]');
      await expect(menu).toBeVisible({ timeout: 15_000 });
      await menu.locator('button', { hasText: 'Move to window' }).click({ timeout: 10_000 });

      // The existing popup now hosts BOTH panels.
      await expect(popup1.locator('.editor-inspector')).toBeVisible({ timeout: 30_000 });
      await expect(popup1.locator('.layers-panel')).toBeVisible({ timeout: 15_000 });

      // Undo from the popup (routes to the primary undo stack, exactly once).
      // The layers panel lives in the popup, so verify there.
      await popup1.locator('[data-testid="aux-undo"]').click({ timeout: 15_000 });
      await expect(popup1.locator('.layers-row')).toHaveCount(0, { timeout: 30_000 });

      // Redo from the popup — the same document comes back.
      await popup1.locator('[data-testid="aux-redo"]').click({ timeout: 15_000 });
      await expect(popup1.locator('.layers-row').first()).toBeVisible({ timeout: 30_000 });

      // Reattach all from the popup: both panels return.
      await popup1.locator('[data-testid="reattach-panel"]').click({ timeout: 15_000 });
      await popup1.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
      await expect(page.locator('.editor__layers-panel .layers-panel')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator('.editor-inspector')).toBeVisible({ timeout: 30_000 });
    });
  });
