import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Background removal — all modes', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    // Dismiss ALL overlays: Welcome dialog + Getting Started panel
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => {
        (d as HTMLDialogElement).close();
      });
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const dismiss = page.getByRole('button', { name: /dismiss/i });
    if (await dismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
      await dismiss.click();
    }
    await page.waitForTimeout(300);
  });

  async function importTestImage(page: import('@playwright/test').Page) {
    const imageDataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 200;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#0066cc';
      ctx.fillRect(0, 0, 200, 200);
      ctx.beginPath();
      ctx.arc(100, 100, 60, 0, Math.PI * 2);
      ctx.fillStyle = '#cc0033';
      ctx.fill();
      ctx.fillStyle = '#33aa33';
      ctx.fillRect(30, 30, 50, 50);
      return c.toDataURL('image/png');
    });
    const base64 = imageDataUrl.split(',')[1]!;
    const tmpFile = path.join('/tmp', `test-${Date.now()}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(base64, 'base64'));
    await page.locator('#file-import-input').setInputFiles(tmpFile);
    await page.waitForTimeout(3000);
    // Close any dialogs that re-appeared after import
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => {
        (d as HTMLDialogElement).close();
      });
    });
    await page.waitForTimeout(300);
    fs.unlinkSync(tmpFile);
  }

  test('Quick toolbar — heuristic bg removal', async ({ page }) => {
    await importTestImage(page);
    const btn = page
      .getByTestId('selection-quick-bar')
      .getByRole('button', { name: 'Remove background' });
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.click();
    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 15000 });
    await expect(review.getByText(/Nothing has been added to the document yet/i)).toBeVisible();
    await review.getByRole('button', { name: 'Apply result' }).click();
    await expect(review).toBeHidden();

    // Verify: canvas should still be visible, no error alerts
    await expect(page.locator('canvas').first()).toBeVisible();
    const alerts = page.locator('[role="alert"]');
    for (let i = 0; i < (await alerts.count()); i++) {
      const t = await alerts.nth(i).textContent();
      expect(t || '').not.toMatch(/failed|unavailable/i);
    }
  });

  test('Inspector — AI Balanced bg removal', async ({ page }) => {
    await importTestImage(page);
    const methodSelect = page.locator('select[aria-label="Background removal method"]');
    await methodSelect.waitFor({ state: 'visible', timeout: 5000 });
    await methodSelect.selectOption('ai-balanced');

    // Click the inspector's Remove Background button
    const btn = page.getByRole('button', { name: 'Remove background from image' });
    await btn.click({ force: true });

    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 30000 });
    await review.getByRole('button', { name: 'Apply result' }).click();
    await expect(review).toBeHidden();
    await expect(page.getByRole('button', { name: 'Re-apply background removal' })).toBeVisible();

    // Verify: no errors, canvas visible
    const errors = page.locator('.insp-hint--error');
    expect(await errors.count()).toBe(0);
    await expect(page.locator('.error-boundary')).toHaveCount(0);
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('No crash after bg removal', async ({ page }) => {
    await importTestImage(page);
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    await page
      .getByTestId('selection-quick-bar')
      .getByRole('button', { name: 'Remove background' })
      .click();
    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 15000 });
    await review.getByRole('button', { name: 'Apply result' }).click();

    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
  });
});
