/**
 * E2E tests for model quality preference in background removal.
 *
 * Tests that:
 * 1. The quality preference radio group is rendered when an image is selected.
 * 2. Each option (Auto / Performance / Quality) can be selected.
 * 3. The editor state updates correctly when the preference is changed.
 * 4. The preference persists across method changes.
 * 5. The advanced details section shows resolved model info.
 *
 * These tests are designed to pass even when the full AI inference pipeline
 * is not available (no model downloaded, no GPU). They only test the UI
 * state management and preference selection, not actual inference.
 */

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const FIXTURE = path.resolve(__dirname, '../fixtures/test-image.png');

test.describe('Model quality preference', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function importImage(page: import('@playwright/test').Page) {
    const importInput = page.locator('#file-import-input');
    await importInput.setInputFiles(FIXTURE);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
  }

  test('renders quality preference radio group when image is selected', async ({ page }) => {
    await importImage(page);

    // Click on the image in the layers panel to select it
    await page.getByRole('treeitem').first().click();

    // The background removal section should be visible
    const bgRemovalSection = page
      .locator('section')
      .filter({ hasText: /Background Removal/i })
      .first();
    await expect(bgRemovalSection).toBeVisible({ timeout: 5000 });

    // The quality preference radio group should be present
    const qualityGroup = page.locator(
      '[role="radiogroup"][aria-label="Model precision preference"]',
    );
    await expect(qualityGroup).toBeVisible({ timeout: 5000 });

    // All three options should be present
    const autoBtn = qualityGroup.getByRole('radio', { name: /Auto/ });
    const perfBtn = qualityGroup.getByRole('radio', { name: /Performance/ });
    const qualityBtn = qualityGroup.getByRole('radio', { name: /Quality/ });

    await expect(autoBtn).toBeVisible();
    await expect(perfBtn).toBeVisible();
    await expect(qualityBtn).toBeVisible();
  });

  test('default quality preference is Auto', async ({ page }) => {
    await importImage(page);
    await page.getByRole('treeitem').first().click();

    const qualityGroup = page.locator(
      '[role="radiogroup"][aria-label="Model precision preference"]',
    );
    await expect(qualityGroup).toBeVisible({ timeout: 5000 });

    // Auto should be selected by default
    const autoBtn = qualityGroup.getByRole('radio', { name: /Auto/ });
    await expect(autoBtn).toBeChecked();
  });

  test('switching to Performance updates state', async ({ page }) => {
    await importImage(page);
    await page.getByRole('treeitem').first().click();

    const qualityGroup = page.locator(
      '[role="radiogroup"][aria-label="Model precision preference"]',
    );
    await expect(qualityGroup).toBeVisible({ timeout: 5000 });

    // Click Performance
    const perfBtn = qualityGroup.getByRole('radio', { name: /Performance/ });
    await perfBtn.click();

    // Performance should now be checked
    await expect(perfBtn).toBeChecked();

    // Auto should no longer be checked
    const autoBtn = qualityGroup.getByRole('radio', { name: /Auto/ });
    await expect(autoBtn).not.toBeChecked();
  });

  test('switching to Quality updates state', async ({ page }) => {
    await importImage(page);
    await page.getByRole('treeitem').first().click();

    const qualityGroup = page.locator(
      '[role="radiogroup"][aria-label="Model precision preference"]',
    );
    await expect(qualityGroup).toBeVisible({ timeout: 5000 });

    // Click Quality
    const qualityBtn = qualityGroup.getByRole('radio', { name: /Quality/ });
    await qualityBtn.click();

    // Quality should now be checked
    await expect(qualityBtn).toBeChecked();
  });

  test('quality preference persists when switching method', async ({ page }) => {
    await importImage(page);
    await page.getByRole('treeitem').first().click();

    // Set to Performance
    const qualityGroup = page.locator(
      '[role="radiogroup"][aria-label="Model precision preference"]',
    );
    await expect(qualityGroup).toBeVisible({ timeout: 5000 });
    await qualityGroup.getByRole('radio', { name: /Performance/ }).click();

    // Switch method to AI Balanced
    const methodSelect = page.locator('select[aria-label="Background removal method"]');
    await methodSelect.selectOption('ai-balanced');

    // Performance should still be checked
    await expect(qualityGroup.getByRole('radio', { name: /Performance/ })).toBeChecked();
  });

  test('advanced details section shows resolved model info', async ({ page }) => {
    await importImage(page);
    await page.getByRole('treeitem').first().click();

    // Set method to AI Balanced to enable model details
    const methodSelect = page.locator('select[aria-label="Background removal method"]');
    await methodSelect.selectOption('ai-balanced');

    // The advanced details should be present
    const details = page.locator('details.insp-model-details');
    await expect(details).toBeVisible({ timeout: 5000 });

    // Expand the details
    await details.locator('summary').click();

    // Should show resolved model info
    await expect(details.locator('dl.insp-model-details__grid')).toBeVisible();
    await expect(details.locator('dt').first()).toBeVisible();
  });

  test('radio group is keyboard accessible', async ({ page }) => {
    await importImage(page);
    await page.getByRole('treeitem').first().click();

    const qualityGroup = page.locator(
      '[role="radiogroup"][aria-label="Model precision preference"]',
    );
    await expect(qualityGroup).toBeVisible({ timeout: 5000 });

    // Focus the first radio button
    const firstRadio = qualityGroup.getByRole('radio').first();
    await firstRadio.focus();

    // Arrow keys should navigate between options
    await page.keyboard.press('ArrowRight');
    const secondRadio = qualityGroup.getByRole('radio').nth(1);
    await expect(secondRadio).toBeFocused();
  });
});
