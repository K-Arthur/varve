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

import AxeBuilder from '@axe-core/playwright';
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
      const layersHeader = page.locator('.layers-panel__header');
      const detachBtn = page.locator('[data-testid="detach-layers"]');
      await expect(detachBtn).toBeVisible({ timeout: 30_000 });
      await expect(layersHeader.locator('[data-testid="detach-layers"]')).toBeVisible({
        timeout: 30_000,
      });
      const targetSize = await detachBtn.evaluate((button) => {
        const styles = getComputedStyle(button);
        return { width: Number.parseFloat(styles.width), height: Number.parseFloat(styles.height) };
      });
      expect(targetSize.width).toBeGreaterThanOrEqual(28);
      expect(targetSize.height).toBeGreaterThanOrEqual(28);

      await expect(detachBtn).toHaveAccessibleName('Detach Layers panel into a new window');
      const primaryAccessibility = await new AxeBuilder({ page })
        .include('.layers-panel__header')
        .analyze();
      expect(primaryAccessibility.violations).toEqual([]);
      await detachBtn.focus();
      const popupPromise = context.waitForEvent('page', { timeout: 60_000 });
      // The visible button is the non-drag keyboard path; Enter must invoke
      // the exact same hydration-gated transfer as a pointer click.
      await page.keyboard.press('Enter');
      const popup = await popupPromise;

      // 2. The popup renders the REAL layers panel with the same layer tree.
      await expect(popup.locator('.layers-panel')).toBeVisible({ timeout: 90_000 });
      await expect(popup.locator('.layers-panel__header')).toBeVisible({ timeout: 30_000 });
      await expect(popup.locator('.layers-row').first()).toBeVisible({ timeout: 30_000 });
      await expect(popup).toHaveTitle('Layers — Varve');
      await expect(popup.getByRole('region', { name: 'layers panel' })).toBeFocused({
        timeout: 10_000,
      });
      const accessibility = await new AxeBuilder({ page: popup }).include('main').analyze();
      expect(accessibility.violations).toEqual([]);

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

    test('independent panel windows + cross-window undo', async ({ page, context }) => {
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

      // Model A deliberately creates a separate, independently recoverable
      // native/popup host for the Inspector rather than grouping it into the
      // Layers window.
      const inspectorDetach = page.locator('[data-testid="detach-inspector"]');
      await expect(inspectorDetach).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator('.insp-panel__tabs-row [data-testid="detach-inspector"]'),
      ).toBeVisible({ timeout: 30_000 });
      const popupPromise2 = context.waitForEvent('page', { timeout: 60_000 });
      await inspectorDetach.click({ timeout: 15_000 });
      const popup2 = await popupPromise2;

      // Each popup hosts exactly its own panel. Neither source panel remains
      // interactive in the primary while its corresponding host is live.
      await expect(popup2.locator('.editor-inspector')).toBeVisible({ timeout: 90_000 });
      await expect(popup1.locator('.layers-panel')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.editor__layers-panel .layers-panel')).toBeHidden({
        timeout: 30_000,
      });
      await expect(page.locator('.editor-inspector')).toBeHidden({ timeout: 30_000 });

      // Undo from the popup (routes to the primary undo stack, exactly once).
      // The layers panel lives in the popup, so verify there.
      await popup1.locator('[data-testid="aux-undo"]').click({ timeout: 15_000 });
      await expect(popup1.locator('.layers-row')).toHaveCount(0, { timeout: 30_000 });

      // Redo from the popup — the same document comes back.
      await popup1.locator('[data-testid="aux-redo"]').click({ timeout: 15_000 });
      await expect(popup1.locator('.layers-row').first()).toBeVisible({ timeout: 30_000 });

      // Reattach each host independently. The first return must not close or
      // duplicate the other panel's window.
      await popup1.locator('[data-testid="reattach-panel"]').click({ timeout: 15_000 });
      await popup1.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
      await expect(page.locator('.editor__layers-panel .layers-panel')).toBeVisible({
        timeout: 30_000,
      });
      await expect(popup2.locator('.editor-inspector')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.editor-inspector')).toBeHidden({ timeout: 30_000 });

      await popup2.locator('[data-testid="reattach-panel"]').click({ timeout: 15_000 });
      await popup2.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
      await expect(page.locator('.editor-inspector')).toBeVisible({ timeout: 30_000 });
    });

    test('panel-header context menu detaches through the same transaction', async ({
      page,
      context,
    }) => {
      await navigateToEditor(page);

      const layersHeader = page.locator('.layers-panel__header');
      await expect(layersHeader).toBeVisible({ timeout: 30_000 });
      await layersHeader.click({ button: 'right' });

      const detachItem = page.getByRole('menuitem', { name: 'Detach Layers Panel' });
      await expect(detachItem).toBeVisible({ timeout: 10_000 });
      const popupPromise = context.waitForEvent('page', { timeout: 60_000 });
      await detachItem.click();
      const popup = await popupPromise;

      await expect(popup.locator('.layers-panel')).toBeVisible({ timeout: 90_000 });
      await expect(page.locator('.editor__layers-panel .layers-panel')).toBeHidden({
        timeout: 30_000,
      });

      await popup.locator('[data-testid="reattach-panel"]').click({ timeout: 15_000 });
      await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
      await expect(page.locator('.editor__layers-panel .layers-panel')).toBeVisible({
        timeout: 30_000,
      });
    });

    test('dragging a panel header detaches it after release outside the header', async ({
      page,
      context,
    }) => {
      await navigateToEditor(page);

      const layersHeader = page.locator('.layers-panel__header');
      const box = await layersHeader.boundingBox();
      if (!box) throw new Error('Layers header not found');

      const popupPromise = context.waitForEvent('page', { timeout: 60_000 });
      await page.mouse.move(box.x + 24, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 24, box.y + box.height + 48, { steps: 4 });
      await page.mouse.up();
      const popup = await popupPromise;

      await expect(popup.locator('.layers-panel')).toBeVisible({ timeout: 90_000 });
      await expect(page.locator('.editor__layers-panel .layers-panel')).toBeHidden({
        timeout: 30_000,
      });

      await popup.locator('[data-testid="reattach-panel"]').click({ timeout: 15_000 });
      await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
      await expect(page.locator('.editor__layers-panel .layers-panel')).toBeVisible({
        timeout: 30_000,
      });
    });

    test('a focused header control opens the detach menu from the keyboard', async ({ page }) => {
      await navigateToEditor(page);

      const detachButton = page.locator('[data-testid="detach-layers"]');
      await detachButton.focus();
      await page.keyboard.press('Shift+F10');

      await expect(page.getByRole('menuitem', { name: 'Detach Layers Panel' })).toBeVisible({
        timeout: 10_000,
      });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitem', { name: 'Detach Layers Panel' })).toBeHidden({
        timeout: 10_000,
      });
    });

    test('the detach control remains WCAG-target-sized in high-contrast mode', async ({ page }) => {
      await navigateToEditor(page);
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'high-contrast';
      });

      const detachButton = page.locator('[data-testid="detach-layers"]');
      await expect(detachButton).toBeVisible({ timeout: 30_000 });
      const state = await detachButton.evaluate((button) => {
        const styles = getComputedStyle(button);
        return {
          width: Number.parseFloat(styles.width),
          height: Number.parseFloat(styles.height),
          borderWidth: Number.parseFloat(styles.borderWidth),
        };
      });
      expect(state.width).toBeGreaterThanOrEqual(28);
      expect(state.height).toBeGreaterThanOrEqual(28);
      expect(state.borderWidth).toBeGreaterThanOrEqual(2);

      await detachButton.focus();
      await expect(detachButton).toBeFocused();
      const accessibility = await new AxeBuilder({ page })
        .include('.layers-panel__header')
        .analyze();
      expect(accessibility.violations).toEqual([]);
    });
  });
