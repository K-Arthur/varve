import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor, switchWorkspace } from '../shared';

/**
 * ImageEnhancementSection's Colors/Min area/Max paths/Alpha threshold fields
 * moved from raw `<input type="number">` with a silent `|| default`
 * coercion to the shared `NumberInput` (click-to-edit, drag-to-scrub,
 * blur/Enter commit, real clamping). Proves the migration in a real browser:
 * typed drafts survive until commit, out-of-range values clamp on commit,
 * and the field disables while a trace is pending.
 */
test.describe('Image & Vector — numeric fields', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/test-image.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await switchWorkspace(page, 'Photo');
    const dismissChecklist = page.getByRole('button', { name: 'Dismiss' });
    if (await dismissChecklist.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dismissChecklist.click();
    }
    await page.getByRole('treeitem').first().click();
  });

  test('Max paths clamps out-of-range drafts on commit and preserves valid ones', async ({
    page,
  }, testInfo) => {
    await page.getByLabel('Enable auto trace').click();
    await page.getByRole('button', { name: 'Advanced' }).click();

    const maxPaths = page.getByLabel('Maximum paths');
    await expect(maxPaths).toBeVisible();

    // Mid-draft: an in-progress edit is not silently coerced to a fallback.
    await maxPaths.fill('500');
    await expect(maxPaths).toHaveValue('500');

    // Out-of-range on commit clamps to the bound, not a hardcoded default.
    await maxPaths.fill('99999');
    await maxPaths.blur();
    await expect(maxPaths).toHaveValue('10000');

    // A normal in-range value commits exactly.
    await maxPaths.fill('750');
    await maxPaths.blur();
    await expect(maxPaths).toHaveValue('750');

    const screenshot = await page
      .locator('.insp-panel, [data-panel="inspector"]')
      .first()
      .screenshot();
    await testInfo.attach('image-enhancement-advanced-fields', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('Alpha threshold and Min area clamp to their bounds on commit', async ({ page }) => {
    const minArea = page.getByLabel('Minimum trace area');
    await minArea.fill('0');
    await minArea.blur();
    await expect(minArea).toHaveValue('1');

    await page.getByLabel('Enable auto trace').click();
    await page.getByRole('button', { name: 'Advanced' }).click();

    const alphaThreshold = page.getByLabel('Alpha threshold');
    await alphaThreshold.fill('-5');
    await alphaThreshold.blur();
    await expect(alphaThreshold).toHaveValue('0');

    await alphaThreshold.fill('999');
    await alphaThreshold.blur();
    await expect(alphaThreshold).toHaveValue('255');
  });

  test('Colors field disables while a one-shot trace is pending, then re-enables', async ({
    page,
  }) => {
    await page.getByLabel('Trace mode').click();
    await page.getByRole('option', { name: 'Color' }).click();

    const colorCount = page.getByLabel('Trace color count');
    await expect(colorCount).toBeEnabled();

    await page.getByRole('button', { name: 'Trace color' }).click();
    // `pending` is set synchronously in the click handler before the async
    // trace call, so the disabled state is visible for a real window.
    await expect(colorCount).toBeDisabled({ timeout: 2000 });
    await expect(colorCount).toBeEnabled({ timeout: 15000 });
  });
});
