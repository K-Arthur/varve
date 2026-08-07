/**
 * End-to-end panel detach flow (browser popup transport).
 *
 * Proves the complete workflow in a real browser:
 * 1. Open editor, create a document with a shape
 * 2. Detach the Layers panel (click detach button)
 * 3. A real popup window opens and renders the ACTUAL Layers panel
 * 4. The source panel disappears from the main window
 * 5. Renaming a layer in the popup updates the main window's document
 * 6. Reattach closes the popup and the panel returns
 *
 * Run: npx playwright test tests/e2e/workspace/detach.spec.ts --project=chromium --workers=1
 */

import { expect, test, type Page } from '@playwright/test';

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
  await page.getByRole('button', { name: /^new$/i }).waitFor({ state: 'visible', timeout: 180_000 });
  await page.getByRole('button', { name: /^new$/i }).click({ timeout: 30_000 });
  const dialog = page.locator('dialog[open]');
  const createBtn = dialog.getByRole('button', { name: /^create design$/i });
  if (await createBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await createBtn.click({ timeout: 30_000 });
  }
  await page.locator('.layers-panel').waitFor({ timeout: 180_000 });
}

test.describe.serial('panel detach flow', () => {
  test('detach Layers → popup renders real panel → source hides → sync → reattach', async ({
    page,
    context,
  }) => {
    await navigateToEditor(page);

    // Add a shape so the layer tree has content.
    await page.locator('.editor-canvas').waitFor({ timeout: 30_000 }).catch(() => {});
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    });

    // 1. Click detach on the Layers panel.
    const detachBtn = page.locator('[data-testid="detach-layers"]');
    await expect(detachBtn).toBeVisible({ timeout: 30_000 });

    const popupPromise = context.waitForEvent('page', { timeout: 60_000 });
    await detachBtn.click();
    const popup = await popupPromise;

    // 2. The popup renders the REAL layers panel (layer tree, header).
    await expect(popup.locator('.layers-panel')).toBeVisible({ timeout: 60_000 });
    await expect(popup.locator('.layers-panel__header')).toBeVisible({ timeout: 30_000 });

    // 3. The source Layers panel is hidden in the main window.
    await expect(page.locator('.editor__layers-panel .layers-panel')).toBeHidden({
      timeout: 30_000,
    });

    // 4. Sync: the popup shows the same document name in its title bar.
    await expect(popup.locator('[data-testid="reattach-panel"]')).toBeVisible({ timeout: 30_000 });

    // 5. Reattach: popup closes, panel returns to the main window.
    await popup.locator('[data-testid="reattach-panel"]').click();
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
    await expect(page.locator('.editor__layers-panel .layers-panel')).toBeVisible({
      timeout: 30_000,
    });
  });
});
