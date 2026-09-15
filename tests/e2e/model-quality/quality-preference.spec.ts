/**
 * E2E coverage for the current background-removal model workflow.
 *
 * The former version of this spec targeted a removed Auto/Performance/Quality
 * radio group. The shipped UI now exposes explicit Fast / AI Balanced / AI
 * High Quality methods, with model availability and guidance shown inline.
 */

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const FIXTURE = path.resolve(__dirname, '../fixtures/test-image.png');

test.describe('Background-removal model workflow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function openBackgroundRemoval(page: import('@playwright/test').Page) {
    const importInput = page.locator('#file-import-input');
    await importInput.setInputFiles(FIXTURE);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await page.getByRole('tab', { name: 'Adjustments', exact: true }).click();
    await page.getByRole('button', { name: 'Background Removal', exact: true }).click();
  }

  function methodSelect(page: import('@playwright/test').Page) {
    return page.getByRole('combobox', { name: 'Background removal method' });
  }

  async function chooseMethod(
    page: import('@playwright/test').Page,
    value: 'quick' | 'ai-balanced' | 'ai-quality',
  ) {
    const labels = {
      quick: /Fast — instant, simple backgrounds/,
      'ai-balanced': /Auto — general photos/,
      'ai-quality': /High quality — fine details/,
    } as const;
    await methodSelect(page).click();
    await page.getByRole('option', { name: labels[value] }).click();
  }

  async function expectModelAvailabilityControl(
    page: import('@playwright/test').Page,
    method: 'balanced' | 'quality',
  ) {
    const download = page.getByRole('button', {
      name: /Download AI model for background removal/i,
    });
    const upgrade = page.getByRole('button', { name: /Download enhanced Balanced model/i });
    if (await download.isVisible().catch(() => false)) return;
    if (method === 'balanced' && (await upgrade.isVisible().catch(() => false))) return;

    // A bundled/cached model intentionally has no download action. Assert the
    // model metadata instead so this test remains valid on both fresh and
    // already-provisioned test profiles.
    await expect(page.locator('.insp-model-info')).toBeVisible();
  }

  test('shows the Fast method and its offline guidance by default', async ({ page }) => {
    await openBackgroundRemoval(page);

    await expect(methodSelect(page)).toContainText('Fast — instant, simple backgrounds');
    await expect(page.getByRole('region', { name: 'Fast cutout guidance' })).toBeVisible();
    await expect(page.getByText('Fast CPU heuristic', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove background from image' })).toBeVisible();
  });

  test('switching to AI Balanced updates guidance and model controls', async ({ page }) => {
    await openBackgroundRemoval(page);

    await chooseMethod(page, 'ai-balanced');
    await expect(methodSelect(page)).toContainText('Auto — general photos');
    await expect(page.getByRole('region', { name: 'Auto cutout guidance' })).toBeVisible();
    await expect(page.getByText(/general-purpose subject detection/i)).toBeVisible();
    await expectModelAvailabilityControl(page, 'balanced');
  });

  test('switching to AI High Quality exposes the high-quality guidance', async ({ page }) => {
    await openBackgroundRemoval(page);

    await chooseMethod(page, 'ai-quality');
    await expect(methodSelect(page)).toContainText('High quality — fine details');
    await expect(page.getByRole('region', { name: 'High-quality cutout guidance' })).toBeVisible();
    await expect(page.getByText(/BiRefNet Lite preserves/i)).toBeVisible();
    await expectModelAvailabilityControl(page, 'quality');
  });

  test('changing methods is keyboard accessible and returns to Fast mode', async ({ page }) => {
    await openBackgroundRemoval(page);

    const select = methodSelect(page);
    await select.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(select).toContainText('Auto — general photos');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(select).toContainText('Fast — instant, simple backgrounds');
    await expect(page.getByRole('region', { name: 'Fast cutout guidance' })).toBeVisible();
  });
});
