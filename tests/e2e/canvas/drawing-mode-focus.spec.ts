import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

test.describe('Drawing Mode — distraction-free canvas & pencil stabilization', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('Ctrl+Shift+F hides chrome and keeps the floating toolbar and an exit affordance', async ({
    page,
  }) => {
    await expect(page.locator('.editor-menubar')).toBeVisible();
    await expect(page.locator('[data-panel="layers"]')).toBeVisible();
    await expect(page.locator('[data-panel="inspector"]')).toBeVisible();
    await expect(page.locator('.editor-status')).toBeVisible();

    await page.keyboard.press('Control+Shift+Period');

    await expect(page.locator('.editor-menubar')).not.toBeVisible();
    await expect(page.locator('[data-panel="layers"]')).not.toBeVisible();
    await expect(page.locator('[data-panel="inspector"]')).not.toBeVisible();
    await expect(page.locator('.editor-status')).not.toBeVisible();
    await expect(page.locator('[data-testid="toolbar"]')).toBeVisible();
    const exitBtn = page.getByRole('button', { name: /exit distraction-free mode/i });
    await expect(exitBtn).toBeVisible();

    await exitBtn.click();
    await expect(page.locator('.editor-menubar')).toBeVisible();
    await expect(page.locator('[data-panel="layers"]')).toBeVisible();
    await expect(page.locator('.editor-status')).toBeVisible();
  });

  test('distraction-free mode toggles off again via the same shortcut', async ({ page }) => {
    await page.keyboard.press('Control+Shift+Period');
    await expect(page.locator('.editor-menubar')).not.toBeVisible();
    await page.keyboard.press('Control+Shift+Period');
    await expect(page.locator('.editor-menubar')).toBeVisible();
  });

  test('View menu exposes Distraction-Free Mode', async ({ page }) => {
    await page.getByRole('menuitem', { name: 'View' }).click();
    await expect(page.getByRole('menuitem', { name: /Distraction-Free Mode/i })).toBeVisible();
  });

  test('pencil tool shows a Stabilization control in the inspector, distinct from the paint brush controls', async ({
    page,
  }) => {
    await page.locator('.workspace-tabs__tab[aria-label="Draw workspace"]').click();

    await page.keyboard.press('Shift+p');
    await expect(page.getByLabel(/^Stabilization/)).toBeVisible();
    await expect(page.getByLabel('Brush preset')).not.toBeVisible();

    await page.keyboard.press('b');
    await expect(page.getByLabel('Brush preset')).toBeVisible();
    await expect(page.getByLabel(/^Smoothing/)).toBeVisible();
  });
});
